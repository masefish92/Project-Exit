// Vercel serverless function serving every /api/* endpoint.
// The dynamic segment [fn] captures the endpoint name: /api/quote → fn="quote".
// All logic lives in lib/finnhub.js so local dev and production behave identically.

const { handle, statusFor } = require("../lib/finnhub");

module.exports = async (req, res) => {
  const query = Object.assign({}, req.query);
  const name = query.fn;
  delete query.fn;

  res.setHeader("cache-control", "no-store");

  try {
    const data = await handle(name, query);
    res.status(200).json(data);
  } catch (err) {
    res.status(statusFor(err)).json({ error: err.message });
  }
};
