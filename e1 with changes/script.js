// Global variables
let orders = [];
let stations = [];
let loadChart = null;
let timeChart = null;

const priorities = ['High', 'Medium', 'Low'];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeCharts();
    loadCustomerOrders();
    balanceLoad();
    initializeTheme();
});

// Theme toggle functionality
function initializeTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('theme') || 'dark';
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeToggle.textContent = savedTheme === 'dark' ? '🌙' : '☀️';
    
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        themeToggle.textContent = newTheme === 'dark' ? '🌙' : '☀️';
        
        // Update chart colors
        updateChartTheme(newTheme);
    });
}

// Update chart colors based on theme
function updateChartTheme(theme) {
    const textColor = theme === 'dark' ? '#e0e0e0' : '#333333';
    const gridColor = theme === 'dark' ? '#555' : '#ddd';
    
    if (loadChart) {
        loadChart.options.plugins.title.color = textColor;
        loadChart.options.plugins.legend.labels.color = textColor;
        loadChart.options.scales.x.ticks.color = textColor;
        loadChart.options.scales.y.ticks.color = textColor;
        loadChart.update();
    }
    
    if (timeChart) {
        timeChart.options.plugins.title.color = textColor;
        timeChart.options.plugins.legend.labels.color = textColor;
        timeChart.update();
    }
}

// Load all orders (CSV + customer orders combined)
async function loadCustomerOrders() {
    try {
        const response = await fetch('http://localhost:3002/api/all-orders');
        const allOrders = await response.json();
        
        // Include all orders (pending and assigned)
        orders = allOrders;
        
        updateOrdersTable();
        updateStats();
    } catch (error) {
        console.error('Error loading orders:', error);
        orders = [];
        updateOrdersTable();
        updateStats();
    }
}

// Load balancing using client-side algorithm - assigns individual items to stations
function balanceLoad() {
    const stationCount = parseInt(document.getElementById('stationCount').value);
    
    if (orders.length === 0) {
        // alert('No orders available. Please place orders first.');
        return;
    }
    
    stations = [];
    for (let i = 1; i <= stationCount; i++) {
        stations.push({
            id: i,
            name: `Station ${i}`,
            items: [],
            totalTime: 0,
            status: 'Idle',
            loadBalance: 0,
            efficiency: 0
        });
    }
    
    // Group items by order and check for shipAlone items
    const orderGroups = [];
    orders.forEach(order => {
        const orderItems = [];
        let hasShipAlone = false;
        let totalOrderTime = 0;
        
        order.itemDetails.forEach(item => {
            let itemTime = item.packTime * item.quantity;
            if (item.vas) itemTime += 2 * item.quantity;
            if (item.fragile) itemTime += 1 * item.quantity;
            
            // Add 1 min extra for non-shipAlone fragile or hazardous items
            if (!item.shipAlone && (item.fragile || item.category === 'Chemicals')) {
                itemTime += 1 * item.quantity;
            }
            
            // Apply priority multiplier
            if (order.priority === 'High') itemTime *= 0.8;
            else if (order.priority === 'Low') itemTime *= 1.2;
            
            const processedItem = {
                orderId: order.id,
                itemName: item.itemName || item.name,
                itemId: item.itemID || item.id,
                packTime: Math.round(itemTime),
                priority: order.priority,
                vas: item.vas,
                fragile: item.fragile,
                shipAlone: item.shipAlone || false,
                quantity: item.quantity
            };
            
            orderItems.push(processedItem);
            totalOrderTime += processedItem.packTime;
            
            if (processedItem.shipAlone) {
                hasShipAlone = true;
            }
        });
        
        orderGroups.push({
            orderId: order.id,
            items: orderItems,
            totalTime: totalOrderTime,
            hasShipAlone: hasShipAlone,
            canCombine: !hasShipAlone
        });
    });
    
    // Separate shipAlone items and combinable groups
    const shipAloneItems = [];
    const combinableGroups = [];
    
    orderGroups.forEach(group => {
        if (group.hasShipAlone) {
            // Split shipAlone items from combinable items
            const combinableItems = [];
            group.items.forEach(item => {
                if (item.shipAlone) {
                    shipAloneItems.push(item);
                } else {
                    combinableItems.push(item);
                }
            });
            
            // Keep combinable items from same order together
            if (combinableItems.length > 0) {
                combinableGroups.push({
                    orderId: group.orderId,
                    items: combinableItems,
                    totalTime: combinableItems.reduce((sum, item) => sum + item.packTime, 0)
                });
            }
        } else {
            // Keep entire order together
            combinableGroups.push({
                orderId: group.orderId,
                items: group.items,
                totalTime: group.totalTime
            });
        }
    });
    
    // Assign combinable groups with load balancing consideration
    combinableGroups.sort((a, b) => b.totalTime - a.totalTime);
    combinableGroups.forEach(group => {
        const avgTime = stations.reduce((sum, s) => sum + s.totalTime, 0) / stations.length;
        const bestStation = stations.reduce((min, station) => 
            station.totalTime < min.totalTime ? station : min
        );
        
        // Check if keeping group together would create imbalance
        const wouldOverload = bestStation.totalTime + group.totalTime > avgTime * 1.3;
        
        if (wouldOverload && group.items.length > 1) {
            // Split items across stations for better balance
            group.items.sort((a, b) => b.packTime - a.packTime);
            group.items.forEach(item => {
                const minStation = stations.reduce((min, station) => 
                    station.totalTime < min.totalTime ? station : min
                );
                
                item.station = minStation.id;
                minStation.items.push(item);
                minStation.totalTime += item.packTime;
                minStation.status = 'Active';
            });
        } else {
            // Keep group together
            group.items.forEach(item => {
                item.station = bestStation.id;
                bestStation.items.push(item);
                bestStation.totalTime += item.packTime;
                bestStation.status = 'Active';
            });
        }
    });
    
    // Assign shipAlone items individually
    shipAloneItems.sort((a, b) => b.packTime - a.packTime);
    shipAloneItems.forEach(item => {
        const bestStation = stations.reduce((min, station) => 
            station.totalTime < min.totalTime ? station : min
        );
        
        item.station = bestStation.id;
        bestStation.items.push(item);
        bestStation.totalTime += item.packTime;
        bestStation.status = 'Active';
    });
    
    // Multi-pass balancing
    for (let pass = 0; pass < 10; pass++) {
        let improved = false;
        
        for (let i = 0; i < stations.length; i++) {
            for (let j = 0; j < stations.length; j++) {
                if (i === j) continue;
                
                const station1 = stations[i];
                const station2 = stations[j];
                
                if (station1.totalTime > station2.totalTime + 5 && station1.items.length > 0) {
                    // Find best item to move
                    let bestItem = null;
                    let bestImprovement = 0;
                    
                    station1.items.forEach(item => {
                        const currentDiff = Math.abs(station1.totalTime - station2.totalTime);
                        const newDiff = Math.abs((station1.totalTime - item.packTime) - (station2.totalTime + item.packTime));
                        const improvement = currentDiff - newDiff;
                        
                        if (improvement > bestImprovement) {
                            bestImprovement = improvement;
                            bestItem = item;
                        }
                    });
                    
                    if (bestItem && bestImprovement > 0) {
                        station1.items = station1.items.filter(item => item !== bestItem);
                        station1.totalTime -= bestItem.packTime;
                        
                        bestItem.station = station2.id;
                        station2.items.push(bestItem);
                        station2.totalTime += bestItem.packTime;
                        
                        improved = true;
                    }
                }
            }
        }
        
        if (!improved) break;
    }
    
    // Update orders to show they are assigned
    orders.forEach(order => {
        order.status = 'Assigned';
        order.station = 'Multiple';
    });
    
    // Update backend with distributed items
    updateBackendOrders(orders);
    
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
    
    updateStationsDisplay();
    updateOrdersTable();
    updateStats();
    updateCharts();
}

// Update backend with order assignments
async function updateBackendOrders(updatedOrders) {
    try {
        await fetch('http://localhost:3002/api/update-orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedOrders)
        });
    } catch (error) {
        console.error('Error updating backend orders:', error);
    }
}

// Update stations display
function updateStationsDisplay() {
    const stationsGrid = document.getElementById('stationsGrid');
    stationsGrid.innerHTML = '';
    
    stations.forEach(station => {
        const stationCard = document.createElement('div');
        stationCard.className = `station-card ${station.status.toLowerCase().replace(' ', '-')}`;
        
        const statusClass = station.status === 'Active' ? 'status-active' : 
                           station.status === 'Idle' ? 'status-idle' : 'status-overloaded';
        
        stationCard.innerHTML = `
            <div class="station-header">
                <div class="station-name">${station.name}</div>
                <div class="station-status ${statusClass}">${station.status}</div>
            </div>
            <div class="station-metrics">
                <div class="metric">
                    <div class="metric-value">${station.items.length}</div>
                    <div class="metric-label">Items</div>
                </div>
                <div class="metric">
                    <div class="metric-value">${Math.round(station.totalTime)}</div>
                    <div class="metric-label">Minutes</div>
                </div>
                <div class="metric">
                    <div class="metric-value">${station.loadBalance}%</div>
                    <div class="metric-label">Balance</div>
                </div>
            </div>
            <div class="station-orders">
                <h4>Assigned Items</h4>
                <div class="station-order-list">
                    ${station.items.map(item => `
                        <div class="station-order-item">
                            <span class="station-order-id">${item.orderId} - ${item.itemName} (x${item.quantity || 1})</span>
                            <span class="station-order-time">${item.packTime}min</span>
                        </div>
                    `).join('')}
                    ${station.items.length === 0 ? '<div style="color: #666; font-style: italic;">No items assigned</div>' : ''}
                </div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${station.efficiency}%"></div>
            </div>
            <div style="text-align: center; margin-top: 5px; font-size: 0.9rem; color: #666;">
                ${station.efficiency}% Load
            </div>
        `;
        
        stationsGrid.appendChild(stationCard);
    });
}

// Update orders display with cards
function updateOrdersTable() {
    const ordersGrid = document.getElementById('ordersGrid');
    ordersGrid.innerHTML = '';
    
    orders.forEach(order => {
        const orderCard = document.createElement('div');
        orderCard.className = `order-card priority-${order.priority.toLowerCase()}`;
        
        const specialHandling = [];
        if (order.hasVAS) specialHandling.push('<span class="vas-badge">VAS</span>');
        if (order.hasFragile) specialHandling.push('<span class="fragile-badge">FRAGILE</span>');
        const specialText = specialHandling.length > 0 ? specialHandling.join(' ') : '';
        
        const priorityClass = `priority-${order.priority.toLowerCase()}`;
        const statusClass = `status-${order.status.toLowerCase()}`;
        
        orderCard.innerHTML = `
            <div class="order-header">
                <span class="order-id">${order.id}</span>
                <span class="order-priority ${priorityClass}">${order.priority}</span>
            </div>
            <div class="order-details">
                <div><strong>${order.items} items:</strong></div>
                ${order.itemDetails.map(item => `<div class="item-detail">• ${item.itemName || item.name}</div>`).join('')}
                ${specialText ? `<div class="special-handling">${specialText}</div>` : ''}
            </div>
            <div class="order-footer">
                <span class="order-time">${order.estimatedTime} min</span>
                ${order.station ? `<span class="order-station">${order.station === 'Multiple' ? 'Items Assigned' : 'Station ' + order.station}</span>` : ''}
            </div>
        `;
        
        ordersGrid.appendChild(orderCard);
    });
}

// Update statistics with time-based metrics
function updateStats() {
    const totalOrders = orders.length;
    const activeStations = stations.filter(s => s.status !== 'Idle').length;
    const avgTime = stations.length > 0 ? 
        Math.round(stations.reduce((sum, s) => sum + s.totalTime, 0) / stations.length) : 0;
    
    // Calculate time balance efficiency
    let efficiency = 0;
    if (stations.length > 0 && activeStations > 0) {
        const activeTimes = stations.filter(s => s.totalTime > 0).map(s => s.totalTime);
        const maxTime = Math.max(...activeTimes);
        const minTime = Math.min(...activeTimes);
        const timeVariance = maxTime - minTime;
        efficiency = maxTime > 0 ? Math.round(((maxTime - timeVariance) / maxTime) * 100) : 0;
    }
    
    document.getElementById('totalOrders').textContent = totalOrders;
    document.getElementById('activeStations').textContent = activeStations;
    document.getElementById('avgTime').textContent = `${avgTime} min`;
    document.getElementById('efficiency').textContent = `${efficiency}%`;
}

// Initialize charts
function initializeCharts() {
    const loadCtx = document.getElementById('loadChart').getContext('2d');
    const timeCtx = document.getElementById('timeChart').getContext('2d');
    
    loadChart = new Chart(loadCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Items per Station',
                data: [],
                backgroundColor: 'rgba(102, 126, 234, 0.8)',
                borderColor: 'rgba(102, 126, 234, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Load Distribution',
                    color: '#e0e0e0'
                },
                legend: {
                    labels: {
                        color: '#e0e0e0'
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#e0e0e0'
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        color: '#e0e0e0'
                    }
                }
            }
        }
    });
    
    timeChart = new Chart(timeCtx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                    '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF',
                    '#4BC0C0', '#FF6384'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Processing Time Distribution',
                    color: '#e0e0e0'
                },
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#e0e0e0'
                    }
                }
            }
        }
    });
}

// Update charts
function updateCharts() {
    if (stations.length === 0) return;
    
    // Update load chart
    loadChart.data.labels = stations.map(s => s.name);
    loadChart.data.datasets[0].data = stations.map(s => s.items.length);
    loadChart.update();
    
    // Update time chart
    const activeStations = stations.filter(s => s.totalTime > 0);
    timeChart.data.labels = activeStations.map(s => s.name);
    timeChart.data.datasets[0].data = activeStations.map(s => s.totalTime);
    timeChart.update();
}

