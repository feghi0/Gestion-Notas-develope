const { test } = require("node:test");
const assert = require("node:assert/strict");
const { destinatariosBoletin } = require("../lib/mailer");
const { clasificarErrorSMTP } = require("../lib/mailer");

test("rechazos SMTP permiten reintentar y cortes sin confirmación requieren revisión", () => {
  assert.equal(clasificarErrorSMTP({ code: "EAUTH" }).incierto, false);
  assert.equal(clasificarErrorSMTP({ responseCode: 550, command: "RCPT TO" }).incierto, false);
  assert.equal(clasificarErrorSMTP({ code: "ETIMEDOUT", command: "DATA" }).incierto, true);
  assert.equal(clasificarErrorSMTP({ code: "ESOCKET" }).incierto, true);
});

test("testing reemplaza los correos originales por un único destinatario", t => {
  const previous = process.env.BOLETINES_TEST_EMAIL;
  t.after(() => {
    if (previous === undefined) delete process.env.BOLETINES_TEST_EMAIL;
    else process.env.BOLETINES_TEST_EMAIL = previous;
  });
  process.env.BOLETINES_TEST_EMAIL = "gestionnotas35@gmail.com";
  assert.deepEqual(destinatariosBoletin({ email_usuario: "alumno@example.com", email_familiar: "familia@example.com" }), ["gestionnotas35@gmail.com"]);
  assert.deepEqual(destinatariosBoletin({}), ["gestionnotas35@gmail.com"]);
  delete process.env.BOLETINES_TEST_EMAIL;
  assert.deepEqual(destinatariosBoletin({ email_usuario: "a@example.com", email_familiar: "a@example.com" }), ["a@example.com"]);
  assert.deepEqual(destinatariosBoletin({}), []);
});
