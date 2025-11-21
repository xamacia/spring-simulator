export default async function handler(req, res) {
    // Vercel.json handles the OPTIONS preflight now, 
    // so we just check for the method we want.
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { url } = req.body;

        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Invalid URL' });
        }

        // 1. Fetch Raw HTML
        const htmlRes = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const htmlText = await htmlRes.text();
        const htmlSize = Buffer.byteLength(htmlText, 'utf8');

        // 2. Fetch Firecrawl
        const apiKey = process.env.FIRECRAWL_API_KEY;
        
        // Safety check for API Key
        if (!apiKey) {
            console.error("API Key is missing in Vercel Environment Variables");
            return res.status(500).json({ error: 'Server Configuration Error. Please check Vercel Logs.' });
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
            markdown = "# Error\nCould not retrieve content from Firecrawl.";
        } else {
            markdown = firecrawlData.data.markdown;
        }

        const mdSize = Buffer.byteLength(markdown, 'utf8');

        // 3. Generate Previews & Metrics
        const costBefore = (htmlSize / 4 / 1000) * 0.0025 * 1000;
        const costAfter = (mdSize / 4 / 1000) * 0.0025 * 1000;
        const reduction = (((htmlSize - mdSize) / htmlSize) * 100).toFixed(1);

        const claudePreview = JSON.stringify({
            source: "Spring AI",
            meta: { url, date: new Date().toISOString() },
            content: markdown.substring(0, 500) + "..."
        }, null, 2);

        const schema = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            "url": url,
            "articleBody": markdown.substring(0, 200) + "..."
        }, null, 2);
        
        const geminiPreview = `<!DOCTYPE html><html><head><script type="application/ld+json">${schema}</script></head><body><div class="markdown-body">${markdown.substring(0, 500).replace(/</g, "&lt;")}...</div></body></html>`;

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