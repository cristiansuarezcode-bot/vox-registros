# Registros Vox

Página interna de Vox Corpus Danza para registrar pagos, ventas de la tienda, uniformes, pagos a profes, gastos y traslados, y consultar saldos.

- **Página:** Next.js exportado como sitio estático, publicado en GitHub Pages (`.github/workflows/pages.yml`).
- **Backend:** Google Apps Script publicado como aplicación web (`backend/Code.gs`, cuenta voxcorpusdanza@gmail.com).
- **Base de datos:** la hoja de cálculo "Registros Vox Corpus Danza".

La página llama al script con `fetch`: POST con el cuerpo JSON como texto y **sin** cabecera `Content-Type` (evita la consulta previa de CORS). Cada usuario entra con su clave; las claves se guardan cifradas en la hoja. Toda escritura usa `LockService` y queda en la pestaña Bitácora. Nada se borra: se anula con motivo.

## Desarrollo

```bash
npm install
NEXT_PUBLIC_API_URL=<url del script>/exec npm run dev
```

## Cambiar el backend

1. Editar `backend/Code.gs` y pegarlo en el proyecto "Registros Vox - Backend" de Apps Script.
2. Implementar → Administrar implementaciones → editar → **Nueva versión** (así la URL no cambia).
