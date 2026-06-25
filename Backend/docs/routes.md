# Backend Route Access Audit

Esta documentación clasifica cada ruta del backend como `public`, `authenticated` o `admin-only`.

| Ruta | Método | Clasificación actual | Clasificación correcta | Observaciones |
|---|---|---|---|---|
| /api/health | GET | public | public | Salud del backend sin auth.
| /api/auth/signup | POST | public | public | Registro de usuario.
| /api/auth/login | POST | public | public | Inicio de sesión.
| /api/auth/logout | POST | public | public | No invalida token server-side; se mantiene pública por diseño actual.
| /api/auth/me | GET | authenticated | authenticated | Devuelve datos de usuario autenticado.
| /api/auth/profile | PATCH | authenticated | authenticated | Actualiza perfil de usuario.
| /api/auth/change-password | POST | authenticated | authenticated | Cambia contraseña autenticado.
| /api/auth/forgot-password | POST | public | public | Recuperación de contraseña sin sesión.
| /api/auth/reset-password | POST | public | public | Reset de contraseña sin sesión.
| /api/auth/verify-recovery-email | POST | public | public | Verificación de correo de recuperación.
| /api/auth/students | GET | admin-only | admin-only | Admin list students.
| /api/auth/students/:id/plan | PATCH | admin-only | admin-only | Admin updates student plan.
| /api/auth/students/:id | DELETE | admin-only | admin-only | Admin deletes student.
| /api/content/ | GET | public | public | Lista de contenido pública con filtrado de plan.
| /api/content/free | GET | authenticated | authenticated | Devuelve contenido free; acceso solo con token.
| /api/content/:id | GET | public | public | Acceso condicional según plan y token opcional.
| /api/content/upload | POST | admin-only | admin-only | Admin upload content.
| /api/content/:id | DELETE | admin-only | admin-only | Admin delete content.
| /api/stats/visit | POST | public | public | Registro de visitas sin auth.
| /api/stats/visits | GET | admin-only | admin-only | Estadísticas protegidas admin.

## Resumen de hallazgos

- Las rutas admin-only ya tenían `adminOnly` aplicado en los archivos de rutas.
- El middleware `verifyToken` no validaba estructura de token ni separaba correctamente los errores de auth.
- `Backend/controllers/contentController.js` hacía verificación JWT duplicada para lectura opcional de contenido.
- Se añadió documentación centralizada para todas las rutas conocidas del backend.
