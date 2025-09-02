const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { initializeDatabase, saveOrder, getAllOrders } = require('./database');

const app = express();

// --- MIDDLEWARE SETUP ---
app.use(cors());
app.use(express.static('.'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// --- START: AUTO-COPY FILES TO PERSISTENT VOLUME ---
// This block ensures your database and data files exist in the /data volume.
const dataPath = '/data';
const initialFiles = ['warehouse.db', 'orders-new.csv', 'customer-orders.json'];

// Create the /data directory if it doesn't exist
if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

initialFiles.forEach(file => {
    const sourcePath = path.resolve(__dirname, file); // File from your repo
    const destPath = path.join(dataPath, file);      // Target in the volume

    // If the file doesn't exist in the volume, copy it from the repo
    if (fs.existsSync(sourcePath) && !fs.existsSync(destPath)) {
        console.log(`Initial setup: Copying '${file}' to persistent volume.`);
        fs.copyFileSync(sourcePath, destPath);
    }
});
// --- END: AUTO-COPY FILES TO PERSISTENT VOLUME ---


// --- PATHS & DATABASE SETUP ---
// These paths now correctly point to the files inside the persistent volume
const dbPath = path.join(dataPath, 'warehouse.db');
const ordersCsvPath = path.join(dataPath, 'orders-new.csv');
const customerOrdersJsonPath = path.join(dataPath, 'customer-orders.json');

// Initialize database
initializeDatabase(dbPath);

// --- API ENDPOINTS ---

// API to get orders from CSV
app.get('/api/orders', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;

    fs.readFile(ordersCsvPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading ordersCsvPath:', err);
            return res.status(500).json({ error: 'Failed to read orders' });
        }
        
        const lines = data.split('\n');
        const orderMap = new Map();
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const values = lines[i].split(',');
            const orderData = {
                orderID: values[0],
                itemID: values[1],
                itemName: values[2],
                category: values[3],
                packTime: parseInt(values[4]),
                weight: parseFloat(values[5]),
                dimensions: values[6],
                vas: values[7] === 'true',
                fragile: values[8] === 'true',
                priority: values[9],
                quantity: parseInt(values[10]) || 1
            };
            
            if (!orderMap.has(orderData.orderID)) {
                orderMap.set(orderData.orderID, {
                    id: orderData.orderID,
                    items: 0,
                    itemDetails: [],
                    priority: orderData.priority,
                    totalPackTime: 0,
                    hasVAS: false,
                    hasFragile: false
                });
            }
            
            const order = orderMap.get(orderData.orderID);
            order.items++;
            orderData.quantity = orderData.quantity || 1;
            order.itemDetails.push(orderData);
            
            let itemPackTime = orderData.packTime * orderData.quantity;
            if (orderData.vas) {
                itemPackTime += 2 * orderData.quantity;
                order.hasVAS = true;
            }
            if (orderData.fragile) {
                itemPackTime += 1 * orderData.quantity;
                order.hasFragile = true;
            }
            
            order.totalPackTime += itemPackTime;
            order.items += orderData.quantity - 1;
        }
        
        const orders = Array.from(orderMap.values()).map(order => {
            let timeMultiplier = 1;
            if (order.priority === 'High') timeMultiplier = 0.8;
            else if (order.priority === 'Low') timeMultiplier = 1.2;
            
            return {
                ...order,
                estimatedTime: Math.round(order.totalPackTime * timeMultiplier),
                station: null,
                status: 'Pending'
            };
        });
        
        res.json(orders);
    });
});

// API to balance load
app.post('/api/balance', (req, res) => {
    const { orders, stationCount } = req.body;
    
    let stations = [];
    for (let i = 1; i <= stationCount; i++) {
        stations.push({
            id: i,
            name: `Station ${i}`,
            orders: [],
            totalTime: 0,
            status: 'Idle',
            loadBalance: 0
        });
    }
    
    const sortedOrders = [...orders].sort((a, b) => {
        const priorityWeight = { 'High': 3, 'Medium': 2, 'Low': 1 };
        if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
            return priorityWeight[b.priority] - priorityWeight[a.priority];
        }
        return b.estimatedTime - a.estimatedTime;
    });
    
    sortedOrders.forEach(order => {
        const bestStation = stations.sort((a, b) => a.totalTime - b.totalTime)[0];
        
        order.station = bestStation.id;
        order.status = 'Assigned';
        bestStation.orders.push(order);
        bestStation.totalTime += order.estimatedTime;
        bestStation.status = 'Active';
    });
    
    const totalTime = stations.reduce((sum, s) => sum + s.totalTime, 0);
    const avgTime = totalTime / stations.length;
    
    stations.forEach(station => {
        if (station.totalTime === 0) {
            station.loadBalance = 0;
            station.efficiency = 0;
            station.status = 'Idle';
        } else {
            station.loadBalance = Math.round(100 - Math.abs(station.totalTime - avgTime) / avgTime * 100);
            station.efficiency = Math.round((station.totalTime / (Math.max(...stations.map(s => s.totalTime)) || 1)) * 100);
            const timeRatio = station.totalTime / avgTime;
            if (timeRatio > 1.2) {
                station.status = 'Overloaded';
            } else if (timeRatio > 0.8) {
                station.status = 'Optimal';
            } else {
                station.status = 'Light Load';
            }
        }
    });
    
    res.json({ orders: sortedOrders, stations });
});

// API to save customer orders (from database.js)
app.post('/api/orders', async (req, res) => {
    try {
        const order = req.body;
        const orderId = await saveOrder(order);
        res.json({ success: true, orderId: orderId });
    } catch (error) {
        console.error('Error saving order:', error);
        res.status(500).json({ error: 'Failed to save order' });
    }
});

// API to get all customer orders (from database.js)
app.get('/api/customer-orders', async (req, res) => {
    try {
        const orders = await getAllOrders();
        res.json(orders);
    } catch (error) {
        console.error('Error loading orders:', error);
        res.status(500).json({ error: 'Failed to load orders' });
    }
});

// API to update order assignments in the JSON file
app.post('/api/update-orders', (req, res) => {
    const updatedOrders = req.body;
    
    try {
        const data = fs.readFileSync(customerOrdersJsonPath, 'utf8');
        const allOrders = JSON.parse(data);
        
        updatedOrders.forEach(updatedOrder => {
            const orderIndex = allOrders.findIndex(o => o.id === updatedOrder.id);
            if (orderIndex !== -1) {
                allOrders[orderIndex].station = updatedOrder.station;
                allOrders[orderIndex].status = updatedOrder.status;
            }
        });
        
        fs.writeFileSync(customerOrdersJsonPath, JSON.stringify(allOrders, null, 2));
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating orders:', error);
        res.status(500).json({ error: 'Failed to update orders' });
    }
});

// --- SERVER STARTUP ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});