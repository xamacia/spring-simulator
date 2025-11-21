import sys
import time
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import requests
from bs4 import BeautifulSoup

# Ensure the template folder is correctly defined
app = Flask(__name__, template_folder='templates')
CORS(app)

FIRECRAWL_API_KEY = "fc-d6a56198ba4e4539bdeb2cade7c11e41"
COST_PER_1K_TOKENS = 0.0025

@app.route('/')
def home():
    return render_template('index.html')

def get_html_metrics(url):
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    try:
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        
        html_content = response.text
        size_bytes = len(html_content.encode('utf-8'))
        
        soup = BeautifulSoup(html_content, 'html.parser')
        text_content = soup.get_text(separator=' ', strip=True)
        text_size = len(text_content.encode('utf-8'))
        
        density = (text_size / size_bytes) * 100 if size_bytes > 0 else 0
        
        return {
            "size": size_bytes,
            "tokens": size_bytes / 4,
            "density": density,
            "cost": (size_bytes / 4 / 1000) * COST_PER_1K_TOKENS
        }
    except Exception as e:
        print(f"Error fetching HTML: {e}")
        raise e

def get_firecrawl_metrics(url, api_key):
    key_to_use = api_key if api_key else FIRECRAWL_API_KEY
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key_to_use}"}
    payload = {
        "url": url,
        "formats": ["markdown"],
        "onlyMainContent": True,
        "includeTags": ["article", "main", "h1", "p", "ul", "ol"]
    }
    
    try:
        response = requests.post("https://api.firecrawl.dev/v1/scrape", json=payload, headers=headers)
        # We don't raise immediately to inspect the error body if needed
        
        if not response.ok:
             print(f"Firecrawl API Error: {response.status_code} - {response.text}")
             raise Exception(f"Firecrawl API failed: {response.text}")

        data = response.json()
        
        # Check for success flag or data presence
        if not data.get('success', True) and 'data' not in data:
             raise Exception("Firecrawl scrape failed: " + str(data))

        if 'data' not in data or 'markdown' not in data['data']:
             raise Exception("Firecrawl returned no markdown data.")

        markdown = data['data']['markdown']
        size_bytes = len(markdown.encode('utf-8'))
        
        return {
            "size": size_bytes,
            "tokens": size_bytes / 4,
            "density": 99.0,
            "cost": (size_bytes / 4 / 1000) * COST_PER_1K_TOKENS
        }
    except Exception as e:
        print(f"Error fetching Firecrawl: {e}")
        raise e

@app.route('/analyze', methods=['POST'])
def analyze():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Invalid JSON payload"}), 400
            
        target_url = data.get('url')
        user_api_key = data.get('apiKey')
        
        if not target_url:
            return jsonify({"error": "URL is required"}), 400

        # Removed emoji to prevent Windows encoding crash
        print(f"Processing URL: {target_url}")

        # 1. Run Standard Fetch
        before_metrics = get_html_metrics(target_url)
        
        # 2. Run Firecrawl Fetch
        after_metrics = get_firecrawl_metrics(target_url, user_api_key)
        
        # 3. Calculate Savings
        savings_pct = ((before_metrics['cost'] - after_metrics['cost']) / before_metrics['cost']) * 100
        size_reduction = ((before_metrics['size'] - after_metrics['size']) / before_metrics['size']) * 100
        multiplier = before_metrics['size'] / after_metrics['size'] if after_metrics['size'] > 0 else 0

        return jsonify({
            "before": before_metrics,
            "after": after_metrics,
            "savings": {
                "pct": savings_pct,
                "reduction": size_reduction,
                "multiplier": multiplier
            }
        })

    except Exception as e:
        print(f"SERVER ERROR: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("Starting server on http://localhost:5000")
    app.run(debug=True, port=5000)