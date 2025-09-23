import axios from 'axios';

class GoogleSheetsAPI {
    constructor(sheetId, apiKey) {
        this.sheetId = sheetId;
        this.apiKey = apiKey;
        this.baseURL = 'https://sheets.googleapis.com/v4/spreadsheets';
    }

    async getSheetData(sheetName) {
        try {
            const url = `${this.baseURL}/${this.sheetId}/values/${sheetName}?key=${this.apiKey}`;
            const response = await axios.get(url);
            console.log('📊 Sheets data fetched successfully');
            return response.data.values;
        } catch (error) {
            console.error('❌ Sheets API Error:', error.message);
            return this.getFallbackData(sheetName);
        }
    }

    getFallbackData(sheetName) {
        console.log('🔄 Using fallback data for:', sheetName);
        
        if (sheetName === 'Sheet1') {
            return [
                ['Category', 'Description', 'Type'],
                ['Uncles Favorite Fries', 'Tongue grabbing fries', 'Basic Fries'],
                ['Uncles Wing Thing', 'Tongue grabbing wings', 'Basic Wings'],
                ['Uncles Loaded Fries', 'One of Wun Fries', 'Loaded fries'],
                ['Uncles Deals', 'Uncles Pro Deals', 'Special Deals'],
                ['Add Ons', 'add-ons for your order', 'Limited Add Ons']
            ];
        }

        if (sheetName === 'Sheet2') {
            return [
                ['Parent Category', 'Item Name', 'Price', 'Options', 'Type'],
                ['Uncles Favorite Fries', 'Regular Fries', '2000', 'Basic Fries', 'item'],
                ['Uncles Favorite Fries', 'Red Hot Fries', '2500', 'Spicy', 'item'],
                ['Uncles Wing Thing', '4pc Chilli Wings', '5500', 'Spicy Wings', 'item'],
                ['Uncles Wing Thing', '4 Crunch Craft Wings', '5000', 'Crunchy Wings', 'item'],
                ['Uncles Loaded Fries', 'Regular Mince Meat Miracle', '6000', 'Minced Meat', 'item'],
                ['Uncles Loaded Fries', 'Regular Beef Suya', '6000', 'Beef suya', 'item'],
                ['Uncles Loaded Fries', 'Cheesy Beef Suya', '7000', 'Cheesy Beef', 'item'],
                ['Uncles Loaded Fries', 'Cheesed Minced Meat Miracle', '7000', 'Cheesy Minced Meat', 'item'],
                ['Uncles Deals', 'Regular Fries+Crunch Craft', '6500', 'Fries and Crunch craft', 'item'],
                ['Uncles Deals', 'Regular Fries+Chilli Wings', '7000', 'Fries and Spicy Wings', 'item'],
                ['Uncles Deals', 'Red Hot Fries+Chilli Wings', '8000', 'spicy fries and spicy wings', 'item'],
                ['Uncles Deals', 'Red Hot Fries+Crunch Craft', '7500', 'spicy fries and crunch craft', 'item'],
                ['Add Ons', 'Extra Cheese', '1000', 'extra cheese on the food', 'item'],
                ['Add Ons', 'Extra Fries', '1000', 'extra fries on the food', 'item']
            ];
        }

        return [];
    }

    // Convert sheet data to menu format
    parseMenuData(rows) {
        if (!rows || rows.length < 2) return [];
        
        const headers = rows[0];
        const menuItems = rows.slice(1);
        
        return menuItems.map(row => {
            const item = {};
            headers.forEach((header, index) => {
                item[header.trim().toLowerCase().replace(/\s+/g, '_')] = row[index] || '';
            });
            return item;
        });
    }
}

export default GoogleSheetsAPI;