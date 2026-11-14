export function errorHandler(error, _req, res, _next) {
  if (error.message === "CORS_ORIGIN_DENIED") {
    return res.status(403).json({ error: "Origin is not allowed in this sandbox." });
  }
  console.error("Request parsing failed:", error.message);
  res.status(400).json({ error: "Invalid request." });
}
