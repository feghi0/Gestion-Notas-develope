// ─── lib/mailer.js ───────────────────────────────────────────────────────────────
// Configuración y envío de mails vía Gmail con contraseña de aplicación.

const nodemailer = require("nodemailer");

function destinatariosBoletin(alumno) {
  const prueba = (process.env.BOLETINES_TEST_EMAIL || "").trim();
  if (prueba) return [prueba];
  return [...new Set([alumno.email_usuario, alumno.email_familiar]
    .map(email => String(email || "").trim()).filter(Boolean))];
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/**
 * Envía el boletín en PDF a una dirección de mail específica.
 *
 * @param {string} destinatario - dirección de email
 * @param {string} asunto - asunto del mail
 * @param {string} nombreAlumno - nombre completo, para el cuerpo del mail
 * @param {Buffer} pdfBuffer - contenido del PDF
 * @param {string} nombreArchivo - nombre del archivo adjunto
 * @returns {Promise<Object>} resultado del envío { ok, error? }
 */
async function enviarBoletinPorMail(destinatario, asunto, nombreAlumno, pdfBuffer, nombreArchivo) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return { ok: false, error: "Falta configurar la cuenta remitente y su contraseña de aplicación de Gmail" };
  }
  try {
    await transporter.sendMail({
      from: `"ET N°35 Ingeniero Eduardo Latzina" <${process.env.GMAIL_USER}>`,
      to: destinatario,
      subject: asunto,
      text:
        `Estimado/a,\n\n` +
        `Adjuntamos el boletín de calificaciones correspondiente a ${nombreAlumno}.\n\n` +
        `Saludos cordiales,\n` +
        `Secretaría — ET N°35 "Ingeniero Eduardo Latzina"`,
      attachments: [
        {
          filename: nombreArchivo,
          content: pdfBuffer,
        },
      ],
    });
    return { ok: true };
  } catch (err) {
    console.error(`Error al enviar mail a ${destinatario}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { enviarBoletinPorMail, destinatariosBoletin };
