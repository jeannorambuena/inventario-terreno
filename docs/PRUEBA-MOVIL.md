# Prueba manual móvil

Esta prueba funciona dentro de la misma red local. No requiere Internet y no envía imágenes fuera del teléfono.

## 1. Obtener la IP del notebook

1. Conecte el notebook a la red Wi-Fi que usará el Samsung.
2. Inicie el servicio con `npm.cmd start`.
   Si Windows solicita permiso para Node.js, permita el acceso solamente en redes privadas.
3. Lea en la consola la línea `Acceso móvil disponible en http://<IP>:3180/mobile`.
4. Como alternativa, abra `http://localhost:3180/api/network-info` en el notebook. Use una dirección privada que comience con `10.`, `172.16` a `172.31`, o `192.168.`.

No configure redirección de puertos en el router. El servicio está diseñado solo para la red local.

## 2. Conectar el Samsung

1. Conecte el Samsung a la misma red Wi-Fi del notebook.
2. Desactive temporalmente los datos móviles si el teléfono intenta cambiar de red.
3. En el notebook, abra `http://localhost:3180`, seleccione Dirección, Departamento y Sección, e inicie una sesión.
4. Escanee el QR mostrado o escriba en el Samsung la URL móvil completa entregada por el notebook.

El enlace contiene un token temporal exclusivo. Renovar el enlace invalida el anterior; cerrar la sesión invalida todos sus enlaces.

## 3. Probar un código correcto (flujo manual-first)

1. Ingrese manualmente un código perteneciente a la ubicación seleccionada.
2. Pulse Enter y confirme que el bien correcto se registra sin pasos adicionales.
3. Confirme que aumente el avance.
4. Intente registrar el mismo código otra vez y confirme que la aplicación lo rechace como duplicado.

## 4. Probar un bien de otra ubicación

1. Ingrese un código conocido que pertenezca a otra ubicación.
2. Compruebe que aparezca `Pertenece a otra ubicación` y se sugiera `Otra ubicación`.
3. Confirme que `Verificado` no esté disponible.
4. Registre la diferencia.

## 5. Probar un código desconocido

1. Ingrese un código sintético que no exista en el inventario.
2. Compruebe que aparezca como bien no registrado y que el sistema genere el identificador `PROV-S…`.
3. Complete descripción, punto físico y evidencia de bien completo.
4. Confirme que no aumente los bienes esperados revisados.

## 6. Probar evidencia fotográfica

Abra una incidencia, seleccione el tipo de evidencia y pulse `Agregar foto`. Puede adjuntar varias fotografías a la misma observación. Las imágenes se guardan sólo en el notebook, con tamaño y SHA-256; no se analizan ni se envían a Internet.

La cámara requiere HTTPS en el Samsung. Si no está disponible, mantenga el ingreso manual de códigos y registre desde el notebook una excepción de evidencia estructurada sólo cuando realmente corresponda.

## 7. Cerrar la sesión

1. Regrese a la interfaz del notebook.
2. Pulse `¿Puedo salir de esta oficina?`.
3. Confirme que el servidor impida cerrar mientras exista un pendiente, ambigüedad, incidencia incompleta o evidencia requerida faltante.
4. Resuelva todo, revise el resumen, marque la confirmación y finalice.
5. En el Samsung, actualice y confirme que el enlace quedó revocado.
