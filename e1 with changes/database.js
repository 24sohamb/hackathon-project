const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'warehouse.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        // Orders table
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            priority TEXT DEFAULT 'Medium',
            status TEXT DEFAULT 'Pending',
            station TEXT,
            estimated_time INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Order items table
        db.run(`CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT,
            item_id TEXT,
            item_name TEXT,
            quantity INTEGER,
            pack_time INTEGER,
            vas BOOLEAN,
            fragile BOOLEAN,
            ship_alone BOOLEAN,
            FOREIGN KEY (order_id) REFERENCES orders (id)
        )`);
    });
}

// Save order to database
function saveOrder(order) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Insert order
            const orderStmt = db.prepare(`INSERT INTO orders 
                (id, customer_name, priority, status, estimated_time) 
                VALUES (?, ?, ?, ?, ?)`);
            
            orderStmt.run([
                order.id,
                order.customerName,
                order.priority,
                order.status,
                order.estimatedTime
            ]);
            orderStmt.finalize();

            // Insert order items
            const itemStmt = db.prepare(`INSERT INTO order_items 
                (order_id, item_id, item_name, quantity, pack_time, vas, fragile, ship_alone) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

            order.itemDetails.forEach(item => {
                itemStmt.run([
                    order.id,
                    item.itemID || item.id,
                    item.itemName || item.name,
                    item.quantity,
                    item.packTime,
                    item.vas,
                    item.fragile,
                    item.shipAlone
                ]);
            });
            itemStmt.finalize();
            resolve(order.id);
        });
    });
}

// Get all orders with items from database
function getAllOrders() {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT o.id, o.customer_name, o.priority, o.status, o.station, o.estimated_time,
                   oi.item_id, oi.item_name, oi.quantity, oi.pack_time, oi.vas, oi.fragile, oi.ship_alone
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            ORDER BY o.created_at DESC
        `;
        
        db.all(query, [], (err, rows) => {
            if (err) reject(err);
            else {
                const orderMap = new Map();
                
                rows.forEach(row => {
                    if (!orderMap.has(row.id)) {
                        orderMap.set(row.id, {
                            id: row.id,
                            customerName: row.customer_name,
                            priority: row.priority,
                            status: row.status,
                            station: row.station,
                            estimatedTime: row.estimated_time,
                            items: 0,
                            itemDetails: [],
                            hasVAS: false,
                            hasFragile: false
                        });
                    }
                    
                    const order = orderMap.get(row.id);
                    if (row.item_id) {
                        order.items += row.quantity;
                        order.itemDetails.push({
                            itemID: row.item_id,
                            itemName: row.item_name,
                            quantity: row.quantity,
                            packTime: row.pack_time,
                            vas: row.vas,
                            fragile: row.fragile,
                            shipAlone: row.ship_alone
                        });
                        if (row.vas) order.hasVAS = true;
                        if (row.fragile) order.hasFragile = true;
                    }
                });
                
                resolve(Array.from(orderMap.values()));
            }
        });
    });
}

module.exports = {
    initializeDatabase,
    saveOrder,
    getAllOrders,
    db
};