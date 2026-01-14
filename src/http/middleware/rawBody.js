function rawBodySaver(req, res, buf) {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}

module.exports = {
  rawBodySaver
};
