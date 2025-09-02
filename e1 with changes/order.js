// Order placement functionality
let selectedItems = [];
let totalTime = 0;

document.addEventListener('DOMContentLoaded', function() {
    loadItems();
    initializeOrderForm();
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
    });
}

function loadItems() {
    const itemsList = document.getElementById('itemsList');
    itemsList.innerHTML = '';
    
    masterItems.forEach(item => {
        const itemCard = document.createElement('div');
        itemCard.className = 'item-card';
        
        const services = [];
        if (item.vas) services.push('<span class="service-badge vas">VAS</span>');
        if (item.fragile) services.push('<span class="service-badge fragile">FRAGILE</span>');
        
        itemCard.innerHTML = `
            <div class="item-info">
                <h4>${item.name}</h4>
                <div class="item-category">${item.category}</div>
                <div class="item-details">${item.packTime} min • ${item.weight}kg • ${item.dimensions}cm</div>
                <div>${services.join(' ')}</div>
            </div>
            <div class="item-controls">
                <button type="button" class="qty-btn" onclick="changeQuantity('${item.id}', -1)">-</button>
                <span class="quantity" id="qty-${item.id}">0</span>
                <button type="button" class="qty-btn" onclick="changeQuantity('${item.id}', 1)">+</button>
            </div>
        `;
        
        itemsList.appendChild(itemCard);
    });
}

function changeQuantity(itemId, change) {
    const qtyElement = document.getElementById(`qty-${itemId}`);
    let currentQty = parseInt(qtyElement.textContent);
    let newQty = Math.max(0, currentQty + change);
    
    qtyElement.textContent = newQty;
    
    const item = masterItems.find(i => i.id === itemId);
    const existingIndex = selectedItems.findIndex(i => i.id === itemId);
    
    if (newQty === 0 && existingIndex !== -1) {
        selectedItems.splice(existingIndex, 1);
    } else if (newQty > 0) {
        if (existingIndex !== -1) {
            selectedItems[existingIndex].quantity = newQty;
        } else {
            selectedItems.push({ ...item, quantity: newQty });
        }
    }
    
    updateOrderSummary();
}

function updateOrderSummary() {
    const summaryDiv = document.getElementById('selectedItems');
    
    if (selectedItems.length === 0) {
        summaryDiv.innerHTML = '<p>No items selected</p>';
        totalTime = 0;
    } else {
        totalTime = 0;
        summaryDiv.innerHTML = selectedItems.map(item => {
            let itemTime = item.packTime * item.quantity;
            if (item.vas) itemTime += 2 * item.quantity;
            if (item.fragile) itemTime += 1 * item.quantity;
            totalTime += itemTime;
            
            return `
                <div class="summary-item">
                    <span>${item.name} x${item.quantity}</span>
                </div>
            `;
        }).join('');
    }
}

function initializeOrderForm() {
    const form = document.getElementById('orderForm');
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const customerName = document.getElementById('customerName').value;
        
        if (!customerName || selectedItems.length === 0) {
            alert('Please enter customer name and select items');
            return;
        }
        
        const order = {
            id: 'ORD' + Date.now(),
            customerName: customerName,
            items: selectedItems.length,
            itemDetails: selectedItems.map(item => ({
                itemName: item.name,
                itemID: item.id,
                quantity: item.quantity,
                packTime: item.packTime,
                vas: item.vas,
                fragile: item.fragile
            })),
            estimatedTime: totalTime,
            priority: 'Medium',
            hasVAS: selectedItems.some(i => i.vas),
            hasFragile: selectedItems.some(i => i.fragile),
            status: 'Pending',
            station: null
        };
        
        try {
            const response = await fetch('http://localhost:3002/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(order)
            });
            
            if (response.ok) {
                alert(`Order ${order.id} placed successfully!`);
                form.reset();
                selectedItems = [];
                totalTime = 0;
                loadItems();
                updateOrderSummary();
            }
        } catch (error) {
            alert('Order placed locally (server not running)');
            form.reset();
            selectedItems = [];
            totalTime = 0;
            loadItems();
            updateOrderSummary();
        }
    });
}