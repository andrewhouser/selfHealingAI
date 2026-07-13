const express = require('express');
const personsRouter = require('./routes/persons');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins (demo purposes)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());
app.use('/persons', personsRouter);

// Only start listening if this file is run directly (not imported for testing)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`\n  🚀 API server listening on http://localhost:${PORT}`);
    console.log(`  Press Ctrl+C to stop\n`);
  });

  // Keep process in foreground and handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n  Shutting down API server...');
    server.close(() => {
      console.log('  Server stopped.');
      process.exit(0);
    });
    // Force exit after 2 seconds if graceful close hangs
    setTimeout(() => process.exit(0), 2000);
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
}

module.exports = app;
