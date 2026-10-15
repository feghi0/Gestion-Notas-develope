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
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function clasificarErrorSMTP(err) {
  const rechazoConfirmado = ["EAUTH", "EENVELOPE", "EMESSAGE", "EDNS", "ETLS"].includes(err.code)
    || (Number(err.responseCode) >= 400 && Number(err.responseCode) <= 599);
  return {
    incierto: !rechazoConfirmado,
    error: rechazoConfirmado
      ? (err.code === "EAUTH" ? "Gmail rechazó las credenciales de la cuenta remitente." : "Gmail rechazó el envío. Revisá el destinatario y la configuración antes de reintentar.")
      : "No se pudo confirmar si Gmail aceptó el correo. Revisá la carpeta Enviados; no se reintentará automáticamente."
  };
}

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
async function enviarBoletinPorMail(destinatario, asunto, nombreAlumno, pdfBuffer, nombreArchivo, options = {}) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return { ok: false, error: "Falta configurar la cuenta remitente y su contraseña de aplicación de Gmail" };
  }
  try {
    const info = await transporter.sendMail({
      from: `"ET N°35 Ingeniero Eduardo Latzina" <${process.env.GMAIL_USER}>`,
      to: destinatario,
      subject: asunto,
      ...(options.messageId ? { messageId: options.messageId } : {}),
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
    if (!info.accepted?.length) return { ok: false, incierto: false, error: "Gmail no aceptó ningún destinatario." };
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error("Error SMTP:", err.code, err.responseCode);
    return { ok: false, ...clasificarErrorSMTP(err) };
  }
}

module.exports = { enviarBoletinPorMail, destinatariosBoletin, clasificarErrorSMTP };
