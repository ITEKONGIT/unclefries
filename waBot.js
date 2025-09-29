import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode";
import axios from "axios";
import { Octokit } from "@octokit/rest";
import GoogleSheetsAPI from "./sheets.js";

let sock;
let latestQR = null;
const userState = {};
const sheets = new GoogleSheetsAPI(process.env.GOOGLE_SHEETS_ID, process.env.GOOGLE_API_KEY);

// GitHub client
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function startBot(app) {
  // Persistent auth in Railway volume
  const { state, saveCreds } = await useMultiFileAuthState("/app/auth");

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
  });

  // Save creds when they change
  sock.ev.on("creds.update", saveCreds);

  // QR + connection handling
  sock.ev.on("connection.update", async (update) => {
    const { connection, qr } = update;
    if (qr) {
      latestQR = qr;
      console.log("📱 New QR generated (scan via /qr or check GitHub)");

      try {
        const qrImage = await qrcode.toBuffer(qr, { type: "png" });
        const content = qrImage.toString("base64");

        // Upload qr.png to GitHub repo
        await octokit.repos.createOrUpdateFileContents({
          owner: process.env.GITHUB_USER,
          repo: process.env.GITHUB_REPO,
          path: "qr.png",
          message: "Update WhatsApp QR",
          content,
          committer: {
            name: "UncleFries Bot",
            email: "bot@unclefries.com",
          },
          author: {
            name: "UncleFries Bot",
            email: "bot@unclefries.com",
          },
        });
        console.log("✅ QR pushed to GitHub successfully");
      } catch (err) {
        console.error("❌ QR upload error:", err.message);
      }
    }
    if (connection === "open") console.log("✅ Bot connected to WhatsApp!");
  });

  // Web endpoint to show QR as PNG in browser
  if (app) {
    app.get("/qr", async (req, res) => {
      if (!latestQR) {
        return res.send("❌ No QR available. Bot may already be connected.");
      }
      try {
        const qrImage = await qrcode.toBuffer(latestQR, { type: "png" });
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(qrImage);
      } catch (err) {
        console.error("QR generation error:", err);
        res.status(500).send("❌ Could not generate QR.");
      }
    });
  }

  // Message handler
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";
    const cleanText = text.trim().toLowerCase();

    if (!userState[from]) {
      userState[from] = { step: "init", cart: [] };
      await sendWhatsAppMessage(
        from,
        "👋 Welcome to UncleFries!\nType *menu* to see categories."
      );
      return;
    }

    const state = userState[from];

    // Handle common commands first
    if (cleanText === "menu" || cleanText === "hi") {
      const categories = await sheets.getCategories();
      state.categories = categories;
      const menuText = generateMainMenu(categories);
      await sendWhatsAppMessage(from, menuText);
      state.step = "category_selection";
      return;
    }

    if (cleanText === "cart") {
      const cartText = generateCartText(state.cart);
      await sendWhatsAppMessage(from, cartText);
      return;
    }

    if (cleanText === "cancel") {
      state.step = "init";
      state.cart = [];
      await sendWhatsAppMessage(from, "❌ Order cancelled. Type *menu* to start over.");
      return;
    }

    if (cleanText === "checkout" && state.cart.length > 0) {
      state.step = "address";
      await sendWhatsAppMessage(from, "📍 Please send your delivery address:");
      return;
    }

    // Step-based handling
    if (state.step === "category_selection") {
      const choice = parseInt(cleanText);
      if (!isNaN(choice) && state.categories && state.categories[choice - 1]) {
        const category = state.categories[choice - 1];
        const items = await sheets.getItemsForCategory(category.category);
        state.currentItems = items;
        const categoryText = generateCategoryMenu(category.category, items);
        await sendWhatsAppMessage(from, categoryText);
        state.step = "item_selection";
      } else {
        await sendWhatsAppMessage(from, "❌ Invalid category choice. Please reply with a number from the menu.");
      }
      return;
    }

    if (state.step === "item_selection") {
      if (cleanText === "back") {
        const menuText = generateMainMenu(state.categories);
        await sendWhatsAppMessage(from, menuText);
        state.step = "category_selection";
        return;
      }

      const choice = parseInt(cleanText);
      if (!isNaN(choice) && state.currentItems && state.currentItems[choice - 1]) {
        state.cart.push(state.currentItems[choice - 1]);
        await sendWhatsAppMessage(
          from,
          `✅ Added *${state.currentItems[choice - 1].item_name}* to cart.\nType another number to add more, *back* for categories, *cart* to view, or *checkout* to proceed.`
        );
      } else {
        await sendWhatsAppMessage(from, "❌ Invalid item choice. Please reply with a number from the category.");
      }
      return;
    }

    if (state.step === "address") {
      state.address = text;
      const total = state.cart.reduce(
        (sum, item) => sum + parseInt(item.price),
        0
      );

      try {
        const res = await axios.post(
          "https://api.paystack.co/transaction/initialize",
          {
            email: `cust_${from.replace(/[@.]/g, "_")}@unclefries.com`,
            amount: total * 100,
            callback_url: `${process.env.BASE_URL}/api/paystack/webhook`,
          },
          {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}` },
          }
        );

        // Payment link to customer
        await sendWhatsAppMessage(
          from,
          `💰 Total: ₦${total}\nPay here: ${res.data.data.authorization_url}`
        );

        // Notify admin
        if (process.env.ADMIN_WAID) {
          await sendWhatsAppMessage(
            process.env.ADMIN_WAID,
            `📦 New order from ${from}\nItems: ${state.cart
              .map((i) => i.item_name)
              .join(", ")}\nTotal: ₦${total}\nAddress: ${state.address}`
          );
        }

        state.step = "paid";
        state.cart = []; // Clear cart after checkout
      } catch (e) {
        console.error("❌ Paystack Error:", e.response?.data || e.message);
        await sendWhatsAppMessage(
          from,
          "❌ Payment link failed. Please try again later."
        );
      }
      return;
    }

    // Fallback
    await sendWhatsAppMessage(from, "❓ Sorry, I didn't understand that. Type *menu* to see options.");
  });
}

export async function sendWhatsAppMessage(jid, text) {
  if (!sock) return;
  await sock.sendMessage(jid, { text });
}

// Helper to generate main menu from categories
function generateMainMenu(categories) {
  let menuText = "🍟 *UncleFries Categories* 🍟\n\n";
  categories.forEach((cat, i) => {
    menuText += `${i + 1}. ${cat.category} - ${cat.description}\n`;
  });
  menuText += "\nReply with the category number to see items.\n";
  menuText += "🛒 Type *cart* to view your order\n";
  menuText += "❌ Type *cancel* to start over";
  return menuText;
}

// Helper to generate category menu
function generateCategoryMenu(categoryName, items) {
  let menuText = `🍟 *${categoryName} Items* 🍟\n\n`;
  items.forEach((item, i) => {
    menuText += `${i + 1}. ${item.item_name} - ₦${item.price} (${item.options})\n`;
  });
  menuText += "\nReply with the item number to add to cart.\n";
  menuText += "🔙 Type *back* to return to categories\n";
  menuText += "🛒 Type *cart* to view your order\n";
  menuText += "✅ Type *checkout* when ready";
  return menuText;
}

// Helper to generate cart text
function generateCartText(cart) {
  if (cart.length === 0) return "🛒 Your cart is empty. Type *menu* to add items.";

  let cartText = "🛒 *Your Cart* 🛒\n\n";
  let total = 0;
  cart.forEach((item, i) => {
    cartText += `${i + 1}. ${item.item_name} - ₦${item.price}\n`;
    total += parseInt(item.price);
  });
  cartText += `\n💰 Total: ₦${total}\n`;
  cartText += "Type *checkout* to proceed or *cancel* to clear.";
  return cartText;
}
