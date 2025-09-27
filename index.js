import express from "express"
import bodyParser from "body-parser"
import crypto from "crypto"
import { sendWhatsAppMessage, startBot } from "./waBot.js"

const app = express()
app.use(bodyParser.json())

// ✅ Paystack webhook
app.post("/api/paystack/webhook", (req, res) => {
  const secret = process.env.PAYSTACK_SECRET
  const hash = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(req.body))
    .digest("hex")

  if (hash === req.headers["x-paystack-signature"]) {
    const event = req.body.event
    if (event === "charge.success") {
      const customer = req.body.data.customer.email
      const amount = req.body.data.amount / 100

      console.log(`✅ Payment confirmed: ₦${amount} from ${customer}`)

      sendWhatsAppMessage(
        process.env.ADMIN_WAID,
        `🚨 New Order Paid!\nAmount: ₦${amount}\nCustomer: ${customer}`
      )
    }
  }

  res.sendStatus(200)
})

// ✅ Root check
app.get("/", (req, res) => res.send("🚀 UncleFries Bot is running!"))

// ✅ Let waBot.js attach /qr route
startBot(app)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`))
