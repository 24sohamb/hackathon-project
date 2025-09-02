import pandas as pd
import json

try:
    # Read the Excel file
    df = pd.read_excel('MasterItems_with_dims.xlsx')
    
    # Convert to JavaScript format
    items = []
    for index, row in df.iterrows():
        item = {
            'id': f'ITM{str(index+1).zfill(3)}',
            'name': str(row.iloc[0]) if pd.notna(row.iloc[0]) else f'Item {index+1}',
            'category': str(row.iloc[1]) if pd.notna(row.iloc[1]) else 'General',
            'packTime': int(row.iloc[2]) if pd.notna(row.iloc[2]) else 1,
            'weight': float(row.iloc[3]) if pd.notna(row.iloc[3]) else 0.1,
            'dimensions': str(row.iloc[4]) if pd.notna(row.iloc[4]) else '10x10x10',
            'vas': bool(row.iloc[5]) if pd.notna(row.iloc[5]) else False,
            'fragile': bool(row.iloc[6]) if pd.notna(row.iloc[6]) else False,
            'shipAlone': bool(row.iloc[7]) if len(row) > 7 and pd.notna(row.iloc[7]) else False
        }
        items.append(item)
    
    # Generate JavaScript code
    js_code = "// Master Items from Excel file\nconst masterItems = [\n"
    for item in items:
        js_code += f"    {{ id: '{item['id']}', name: '{item['name']}', category: '{item['category']}', packTime: {item['packTime']}, weight: {item['weight']}, dimensions: '{item['dimensions']}', vas: {str(item['vas']).lower()}, fragile: {str(item['fragile']).lower()}, shipAlone: {str(item['shipAlone']).lower()} }},\n"
    js_code += "];"
    
    # Write to file
    with open('master-items-updated.js', 'w') as f:
        f.write(js_code)
    
    print(f"Successfully processed {len(items)} items from Excel file")
    print("Generated master-items-updated.js")
    
except Exception as e:
    print(f"Error: {e}")
    print("Please install pandas: pip install pandas openpyxl")