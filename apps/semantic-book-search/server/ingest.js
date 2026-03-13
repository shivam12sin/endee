// ingest.js
// This script:
// 1. Reads books from books.json
// 2. Converts each book description into a vector embedding
// 3. Stores the vectors + metadata into Endee vector database

import { Endee, Precision } from 'endee';
import { pipeline } from '@xenova/transformers';
import { readFileSync } from 'fs';

const INDEX_NAME = 'books';
const DIMENSION = 384; // all-MiniLM-L6-v2 outputs 384-dimensional vectors

async function main() {
  console.log('🚀 Starting ingestion...\n');

  // ── 1. Connect to Endee (running at localhost:8080 via Docker) ──
  const client = new Endee();

  // ── 2. Create the index (like a "table" in a regular database) ──
  //    dimension: must match the embedding model output size (384)
  //    spaceType: 'cosine' means we measure similarity by angle between vectors
  //    precision: INT8 saves memory with minimal quality loss
  try {
    await client.createIndex({
      name: INDEX_NAME,
      dimension: DIMENSION,
      spaceType: 'cosine',
      precision: Precision.INT8,
    });
    console.log(`✅ Created index: "${INDEX_NAME}"`);
  } catch (err) {
    // Index might already exist — that's fine, continue
    console.log(`ℹ️  Index "${INDEX_NAME}" already exists, skipping creation.`);
  }

  // ── 3. Load the embedding model ──
  //    all-MiniLM-L6-v2 is a lightweight model that runs locally (no API key needed)
  //    It converts any text into a 384-dimensional vector
  console.log('\n📦 Loading embedding model (first run downloads ~25MB)...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✅ Embedding model ready\n');

  // ── 4. Load books from JSON ──
  const books = JSON.parse(readFileSync('./data/books.json', 'utf-8'));
  console.log(`📚 Found ${books.length} books to ingest\n`);

  // ── 5. Generate embeddings and upsert into Endee ──
  const index = await client.getIndex(INDEX_NAME);
  const vectors = [];

  for (const book of books) {
    // We embed the description because that's what the user will search by meaning
    const text = `${book.title} by ${book.author}. ${book.description}`;
    
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data); // convert tensor to plain JS array

    vectors.push({
      id: book.id,
      vector: vector,
      meta: {
        title: book.title,
        author: book.author,
        genre: book.genre,
        description: book.description,
      },
    });

    console.log(`  ✔ Embedded: "${book.title}"`);
  }

  // Upsert all vectors in one batch (faster than one-by-one)
  await index.upsert(vectors);
  console.log(`\n🎉 Successfully ingested ${vectors.length} books into Endee!`);
  console.log('👉 Now run: node server/index.js');
}

main().catch(console.error);
