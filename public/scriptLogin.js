document.getElementById("loginForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const dni      = document.getElementById("dni").value.trim();
  const password = document.getElementById("password").value;

  if (!dni || !password) {
    mostrarMensaje("Te falta completar el DNI o la contraseña.", "error");
    return;
  }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dni, password })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      mostrarMensaje(data.error || "No pudimos iniciar sesión. Revisá el DNI y la contraseña.", "error");
      return;
    }

    localStorage.setItem("token", data.token);
    sessionStorage.removeItem("cicloLectivo");
    localStorage.setItem("id", data.id);
    localStorage.setItem("usuario", data.usuario);
    localStorage.setItem("rango", data.rango);
    localStorage.setItem("permiso", data.permiso);

    if (data.debeCambiarPassword) {
      location.href = "cambiar.html?usuario=" + encodeURIComponent(data.usuario);
    } else {
      location.href = "dashboard.html";
    }
  } catch (err) {
    console.error("Error de login:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.", "error");
  }
});

initAyuda({
  general: "Ingresá tu número de DNI (sin puntos) y la contraseña que te dieron. Si es la primera vez que entrás, después del login vas a tener que crear una contraseña nueva."
});
