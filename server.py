import sys
import time
import os
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import requests
from bs4 import BeautifulSoup

app = Flask(__name__, template_folder='templates')
CORS(app)

# Get key from environment or use default (Keep your key secret in production!)
FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "fc-d6a56198ba4e4539bdeb2cade7c11e41")
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
        
        # Calculate Density
        soup = BeautifulSoup(html_content, 'html.parser')
        text_content = soup.get_text(separator=' ', strip=True)
        text_size = len(text_content.encode('utf-8'))
        
        density = (text_size / size_bytes) * 100 if size_bytes > 0 else 0
        
        return {
            "size": size_bytes,
            "tokens": size_bytes / 4,
            "density": density,
            "cost": (size_bytes / 4 / 1000) * COST_PER_1K_TOKENS,
            "snippet": html_content[:500] + "..." # Send first 500 chars for preview
        }
    except Exception as e:
        print(f"Error fetching HTML: {e}")
        raise e

def get_firecrawl_metrics(url):
    # backend always uses its own key
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {FIRECRAWL_API_KEY}"}
    payload = {
        "url": url,
        "formats": ["markdown"],
        "onlyMainContent": True,
        "includeTags": ["article", "main", "h1", "p", "ul", "ol"]
    }
    
    try:
        response = requests.post("https://api.firecrawl.dev/v1/scrape", json=payload, headers=headers)
        if not response.ok:
             print(f"Firecrawl API Error: {response.status_code} - {response.text}")
             raise Exception(f"Firecrawl API failed: {response.text}")

        data = response.json()
        if 'data' not in data or 'markdown' not in data['data']:
             raise Exception("Firecrawl returned no markdown data.")

        markdown = data['data']['markdown']
        size_bytes = len(markdown.encode('utf-8'))
        
        return {
            "size": size_bytes,
            "tokens": size_bytes / 4,
            "density": 99.0,
            "cost": (size_bytes / 4 / 1000) * COST_PER_1K_TOKENS,
            "snippet": markdown[:500] + "..." # Send first 500 chars for preview
        }
    except Exception as e:
        print(f"Error fetching Firecrawl: {e}")
        raise e

@app.route('/analyze', methods=['POST'])
def analyze():
    try:
        data = request.json
        if not data: return jsonify({"error": "Invalid JSON"}), 400
            
        target_url = data.get('url')
        if not target_url: return jsonify({"error": "URL is required"}), 400

        print(f"Processing URL: {target_url}")

        # 1. Run Standard Fetch
        before_metrics = get_html_metrics(target_url)
        
        # 2. Run Firecrawl Fetch (No API key needed from frontend)
        after_metrics = get_firecrawl_metrics(target_url)
        
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
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)