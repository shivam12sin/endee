// server/index.js
// Express API server with one endpoint: GET /search?q=your+query
// Flow: query text → embedding → Endee vector search → JSON results

import express from 'express';
import cors from 'cors';
import { Endee } from 'endee';
import { pipeline } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const INDEX_NAME = 'books';

app.use(cors()); // allow frontend (different port) to call this API
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ── Global state: load model once at startup ──
let embedder = null;
let endeeIndex = null;

async function init() {
  console.log('🔌 Connecting to Endee...');
  const client = new Endee();
  endeeIndex = await client.getIndex(INDEX_NAME);
  console.log('✅ Endee connected');

  console.log('📦 Loading embedding model...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✅ Embedding model ready');

  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
}

// ── GET /search?q=your+query&limit=5 ──
app.get('/search', async (req, res) => {
  const query = req.query.q;
  const limit = parseInt(req.query.limit) || 5;

  // Validate input
  if (!query || query.trim() === '') {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    // Step 1: Convert query text → vector embedding (same model as ingest)
    const output = await embedder(query, { pooling: 'mean', normalize: true });
    const queryVector = Array.from(output.data);

    // Step 2: Ask Endee to find topK most similar vectors
    const results = await endeeIndex.query({
      vector: queryVector,
      topK: limit,
    });

    // Step 3: Format and return results
    const formatted = results.map((r) => ({
      id: r.id,
      similarity: parseFloat(r.similarity.toFixed(3)), // 0.0 to 1.0
      title: r.meta.title,
      author: r.meta.author,
      genre: r.meta.genre,
      description: r.meta.description,
    }));

    console.log(`🔍 Query: "${query}" → ${formatted.length} results`);
    res.json({ query, results: formatted });

  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: !!embedder, db: !!endeeIndex });
});

// Start everything
init().then(() => {
  app.listen(PORT);
}).catch((err) => {
  console.error('❌ Startup failed:', err.message);
  process.exit(1);
});
