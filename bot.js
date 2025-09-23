import express from 'express';
import GoogleSheetsAPI from './sheets.js';

const app = express();
app.use(express.json());

// Initialize Sheets API
const sheets = new GoogleSheetsAPI(
    process.env.GOOGLE_SHEETS_ID ,
    process.env.GOOGLE_API_KEY
);

// In-memory cart storage (for development)
const userCarts = new Map();

// Helper function to format currency
function formatPrice(price) {
    return `₦${parseInt(price).toLocaleString()}`;
}

// Generate menu text from categories
async function generateMainMenu() {
    try {
        const categories = await sheets.getSheetData('Sheet1');
        const categoryRows = categories.slice(1); // Remove header
        
        let menuText = "🍟 *WELCOME TO UNCLE'S FRIES!* 🍗\n\n";
        menuText += "*Please choose a category:*\n\n";
        
        categoryRows.forEach((row, index) => {
            const [category, description] = row;
            menuText += `*${index + 1}. ${category}*\n`;
            menuText += `   ${description}\n\n`;
        });
        
        menuText += "📍 *Reply with the number of your choice*\n";
        menuText += "🛒 *Type 'cart' to view your order*\n";
        menuText += "❌ *Type 'cancel' to start over*";
        
        return menuText;
    } catch (error) {
        console.error('Menu generation error:', error);
        return "🍟 *WELCOME TO UNCLE'S FRIES!* 🍗\n\nPlease type 'menu' to see our offerings!";
    }
}

// Generate items for a specific category
async function generateCategoryMenu(categoryIndex) {
    try {
        const categories = await sheets.getSheetData('Sheet1');
        const categoryName = categories[categoryIndex][0];
        
        const menuItems = await sheets.getSheetData('Sheet2');
        const categoryItems = menuItems.slice(1).filter(row => row[0] === categoryName);
        
        let menuText = `*${categoryName.toUpperCase()}* 🍽️\n\n`;
        
        categoryItems.forEach((item, index) => {
            const [_, itemName, price, description] = item;
            menuText += `*${index + 1}. ${itemName}* - ${formatPrice(price)}\n`;
            menuText += `   📝 ${description}\n\n`;
        });
        
        menuText += `📍 *Reply with item number to add to cart*\n`;
        menuText += `🔙 *Type 'back' to return to main menu*`;
        
        return menuText;
    } catch (error) {
        return "❌ Sorry, couldn't load menu items. Please try again.";
    }
}

// Routes
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Uncle's Fries WhatsApp Bot</title>
            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                .status { background: #f0f8ff; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .endpoints { background: #f0f0f0; padding: 15px; border-radius: 5px; }
            </style>
        </head>
        <body>
            <h1>🍟 Uncle's Fries WhatsApp Bot 🍗</h1>
            <div class="status">
                <h2>✅ Server is Running</h2>
                <p><strong>Status:</strong> Operational</p>
                <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
                <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            </div>
            <div class="endpoints">
                <h3>📊 Available Endpoints:</h3>
                <ul>
                    <li><a href="/health">/health</a> - System status</li>
                    <li><a href="/test-menu">/test-menu</a> - Test menu generation</li>
                    <li><strong>POST /webhook</strong> - WhatsApp webhook</li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: "Uncle's Fries WhatsApp Bot",
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});

app.get('/test-menu', async (req, res) => {
    try {
        const menu = await generateMainMenu();
        res.json({
            success: true,
            menu_text: menu,
            raw_menu: menu.replace(/\n/g, '<br>')
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// WhatsApp webhook endpoint
app.post('/webhook', async (req, res) => {
    console.log('📱 Webhook received:', req.body);
    
    // Simulate WhatsApp response (for testing)
    const response = {
        status: 'webhook_received',
        message: 'WhatsApp integration ready',
        next_step: 'Connect Twilio/Termii webhook to this URL',
        webhook_url: `${req.protocol}://${req.get('host')}/webhook`
    };
    
    res.json(response);
});

// Error handling
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    🚀 UNCLE'S FRIES BOT DEPLOYED SUCCESSFULLY!
    🌐 Server running on port: ${PORT}
    📊 Google Sheets ID: ${process.env.GOOGLE_SHEETS_ID || 'Using default'}
    ⏰ Started at: ${new Date().toISOString()}
    
    📋 Available Routes:
    ✅ GET  /          - Server status page
    ✅ GET  /health    - Health check
    ✅ GET  /test-menu - Test menu generation
    ✅ POST /webhook   - WhatsApp webhook
    
    🔜 Next Steps:
    1. Test /health endpoint
    2. Test /test-menu endpoint  
    3. Connect WhatsApp provider webhook
    4. Go live! 🎉
    `);
});

export default app;