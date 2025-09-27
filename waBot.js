import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys"
import P from "pino"
import qrcode from "qrcode"
import axios from "axios"
import GoogleSheetsAPI from "./sheets.js"

let sock
let latestQR = null
const userState = {}
const sheets = new GoogleSheetsAPI(process.env.SHEET_ID, process.env.SHEET_API_KEY)

export async function startBot(app) {
  // Persistent auth in Railway volume
  const { state, saveCreds } = await useMultiFileAuthState("/app/auth")

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  })

  // Save creds when they change
  sock.ev.on("creds.update", saveCreds)

  // QR + connection handling
  sock.ev.on("connection.update", (update) => {
    const { connection, qr } = update
    if (qr) {
      latestQR = qr
      console.log("📱 New QR generated (scan via /qr endpoint)")
    }
    if (connection === "open") console.log("✅ Bot connected to WhatsApp!")
  })

  // ✅ Web endpoint to show QR as PNG in browser
  if (app) {
    app.get("/qr", async (req, res) => {
      if (!latestQR) {
        return res.send("❌ No QR available. Bot may already be connected.")
      }
      try {
        const qrImage = await qrcode.toBuffer(latestQR, { type: "png" })
        res.writeHead(200, { "Content-Type": "image/png" })
        res.end(qrImage)
      } catch (err) {
        console.error("QR generation error:", err)
        res.status(500).send("❌ Could not generate QR.")
      }
    })
  }

  // Message handler
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""
    const cleanText = text.trim().toLowerCase()

    if (!userState[from]) {
      userState[from] = { step: "init", cart: [] }
      await sendWhatsAppMessage(
        from,
        "👋 Welcome to UncleFries!\nType *menu* to see items."
      )
      return
    }

    const state = userState[from]

    // Show menu
    if (cleanText === "menu") {
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

    // Ordering step
    if (state.step === "ordering") {
      const choice = parseInt(cleanText)
      if (!isNaN(choice) && state.menu[choice - 1]) {
        state.cart.push(state.menu[choice - 1])
        await sendWhatsAppMessage(
          from,
          `✅ Added *${state.menu[choice - 1].item_name}*.\nType *checkout* or pick another.`
        )
      } else {
        await sendWhatsAppMessage(from, "❌ Invalid choice.")
      }
      return
    }

    // Checkout step
    if (cleanText === "checkout") {
      state.step = "address"
      await sendWhatsAppMessage(from, "📍 Send me your delivery address:")
      return
    }

    // Address collection
    if (state.step === "address") {
      state.address = text
      const total = state.cart.reduce(
        (sum, item) => sum + parseInt(item.price),
        0
      )

      try {
        const res = await axios.post(
          "https://api.paystack.co/transaction/initialize",
          {
            email: `cust_${from.replace(/[@.]/g, "_")}@unclefries.com`,
            amount: total * 100,
            callback_url: `${process.env.BASE_URL}/api/paystack/webhook`
          },
          {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}` }
          }
        )

        // Payment link to customer
        await sendWhatsAppMessage(
          from,
          `💰 Total ₦${total}\nPay here: ${res.data.data.authorization_url}`
        )

        // Notify admin
        if (process.env.ADMIN_WAID) {
          await sendWhatsAppMessage(
            process.env.ADMIN_WAID,
            `📦 New order from ${from}\nItems: ${state.cart
              .map((i) => i.item_name)
              .join(", ")}\nTotal: ₦${total}\nAddress: ${state.address}`
          )
        }

        state.step = "paid"
      } catch (e) {
        console.error("❌ Paystack Error:", e.response?.data || e.message)
        await sendWhatsAppMessage(
          from,
          "❌ Payment link failed, please try again later."
        )
      }
    }
  })
}

export async function sendWhatsAppMessage(jid, text) {
  if (!sock) return
  await sock.sendMessage(jid, { text })
}
