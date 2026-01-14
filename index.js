require("./instrument");

require("dotenv").config();

const { startServer } = require("./server/server");

startServer();
