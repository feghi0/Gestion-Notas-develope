require("dotenv").config();
const express = require("express");
const path    = require("path");
const app = express();

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api",       require("./routes/auth"));
app.use("/dashboard", require("./routes/dash"));
app.use("/planilla",  require("./routes/planilla"));
app.use("/boletines", require("./routes/boletines"));
app.use("/usuarios", require("./routes/usuarios"));

app.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
}).on("error", (err) => {
  console.error("Error al iniciar el servidor:", err);
  process.exit(1);
});