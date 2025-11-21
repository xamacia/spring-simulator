export default async function handler(req, res) {
    // 1. CORS Headers (Essential for the frontend to talk to this backend)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Handle "Preflight" OPTIONS request (Browser security check)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Ensure it's a POST request
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { url } = req.body; // Standard Node.js body parsing

        // Validate URL
        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Invalid URL' });
        }

        // 2. Fetch Raw HTML (Simulate Standard Bot)
        const htmlStart = Date.now();
        const htmlRes = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const htmlText = await htmlRes.text();
        const htmlSize = Buffer.byteLength(htmlText, 'utf8');

        // 3. Fetch Firecrawl (Simulate Spring AI)
        const apiKey = process.env.FIRECRAWL_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ error: 'Server Configuration Error: Missing API Key' });
        }

        const firecrawlRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                url: url,
                formats: ["markdown"],
                onlyMainContent: true,
                includeTags: ["article", "main", "h1", "p", "ul", "ol"]
            })
        });

        const firecrawlData = await firecrawlRes.json();
        
        let markdown = "";
        if (!firecrawlData.data || !firecrawlData.data.markdown) {
            // Fallback if Firecrawl fails or rate limit hit
            markdown = "# Error\nCould not retrieve content from Firecrawl. Please check the URL or API Quota.";
        } else {
            markdown = firecrawlData.data.markdown;
        }

        const mdSize = Buffer.byteLength(markdown, 'utf8');

        // 4. Generate Previews (Replicating the Plugin Logic)
        
        // Claude Preview (Structured JSON)
        const claudePreview = JSON.stringify({
            source: "Spring AI",
            meta: {
                url: url,
                generated: new Date().toISOString(),
                tokens_saved: Math.round((htmlSize - mdSize) / 4)
            },
            content: markdown.substring(0, 500) + "..."
        }, null, 2);

        // Gemini Preview (Schema.org HTML)
        const schema = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            "url": url,
            "articleBody": markdown.substring(0, 200) + "..."
        }, null, 2);

        const geminiPreview = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
${schema}
  </script>
</head>
<body>
  <div class="markdown-body">
    ${markdown.substring(0, 500).replace(/</g, "&lt;")}...
  </div>
</body>
</html>`;

        // 5. Calculate Metrics
        const costBefore = (htmlSize / 4 / 1000) * 0.0025 * 1000;
        const costAfter = (mdSize / 4 / 1000) * 0.0025 * 1000;
        const reduction = (((htmlSize - mdSize) / htmlSize) * 100).toFixed(1);

        // 6. Return Success Response
        return res.status(200).json({
            success: true,
            metrics: {
                html_size: (htmlSize / 1024).toFixed(2),
                md_size: (mdSize / 1024).toFixed(2),
                reduction: reduction,
                cost_before: costBefore.toFixed(2),
                cost_after: costAfter.toFixed(2)
            },
            previews: {
                gpt: markdown,
                claude: claudePreview,
                gemini: geminiPreview
            }
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}