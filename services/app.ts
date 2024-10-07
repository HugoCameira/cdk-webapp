import express from 'express';

const app = express();
const port = 80;

app.get('/wrapped/*', (req, res) => {
  res.send('Hello from the wrapped path! main env');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.sendStatus(200); // Respond with HTTP 200 OK status
});

// Middleware to log unavailable paths
app.use((req, res, next) => {
  console.log(`Path not available: ${req.path}`);
  res.status(404).send('Path not available from dev env');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});