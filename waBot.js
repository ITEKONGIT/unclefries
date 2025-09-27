import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys"
import P from "pino"
import axios from "axios"
import GoogleSheetsAPI from "./sheets.js"

let sock
const userState = {}
const sheets = new GoogleSheetsAPI(process.env.SHEET_ID, process.env.SHEET_API_KEY)

export async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: true
  })

  sock.ev.on("creds.update", saveCreds)
  sock.ev.on("connection.update", (update) => {
    if (update.connection === "open") console.log("✅ Bot connected to WhatsApp!")
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const text = msg.message.conversation?.trim().toLowerCase()

    if (!userState[from]) {
      userState[from] = { step: "init", cart: [] }
      await sendWhatsAppMessage(from, "👋 Welcome to UncleFries!\nType *menu* to see items.")
      return
    }

    const state = userState[from]

    if (text === "menu") {
      const rows = await sheets.getSheetData("Sheet2")
      const menu = sheets.parseMenuData(rows)
      let menuText = "🍟 *UncleFries Menu* 🍟\n\n"
      menu.forEach((item, i) => {
        menuText += `${i + 1}. ${item.item_name} - ₦${item.price}\n`
      })
      menuText += "\nReply with the item number to add."
      await sendWhatsAppMessage(from, menuText)
      state.menu = menu
      state.step = "ordering"
      return
    }

    if (state.step === "ordering") {
      const choice = parseInt(text)
      if (!isNaN(choice) && state.menu[choice - 1]) {
        state.cart.push(state.menu[choice - 1])
        await sendWhatsAppMessage(from, `✅ Added *${state.menu[choice - 1].item_name}*.\nType *checkout* or pick another.`)
      } else {
        await sendWhatsAppMessage(from, "❌ Invalid choice.")
      }
      return
    }

    if (text === "checkout") {
      state.step = "address"
      await sendWhatsAppMessage(from, "📍 Send me your delivery address:")
      return
    }

    if (state.step === "address") {
      state.address = msg.message.conversation
      const total = state.cart.reduce((sum, item) => sum + parseInt(item.price), 0)

      try {
        const res = await axios.post("https://api.paystack.co/transaction/initialize", {
          email: `cust_${from}@unclefries.com`,
          amount: total * 100,
          callback_url: "https://yourdomain.com/api/paystack/webhook"
        }, {
          headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}` }
        })

        await sendWhatsAppMessage(from, `💰 Total ₦${total}\nPay here: ${res.data.data.authorization_url}`)
        state.step = "paid"
      } catch (e) {
        await sendWhatsAppMessage(from, "❌ Payment link failed.")
      }
    }
  })
}

export async function sendWhatsAppMessage(jid, text) {
  if (!sock) return
  await sock.sendMessage(jid, { text })
}
