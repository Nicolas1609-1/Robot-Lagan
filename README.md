# Robot-Lagan · Samurái 3D

Web local con cuerpo completo, manos articuladas y gestos faciales.

Los modelos de MediaPipe y el SDK se preparan con `npm run prepare` desde
`tools` y no se guardan en Git. Las dependencias, compilaciones, cachés y copias
antiguas también quedan fuera del repositorio. El código, el robot y las pruebas
se conservan en `src`, `public` y `tools`.

## Esqueleto del robot

El samurái tiene **64 huesos** enlazados en una jerarquía: pelvis, columna,
pecho, cuello, cabeza, clavículas, brazos, muñecas, falanges, piernas y pies.
La malla está ligada al esqueleto mediante pesos de vértices (SkinnedMesh).
Las placas de armadura siguen su articulación sin estirarse; el núcleo del torso
reparte su flexión entre abdomen y pecho. Una muñeca es hija del antebrazo y un
antebrazo es hijo del brazo, por lo que sus posiciones permanecen conectadas.

Activa **Esqueleto** para ver los huesos y sus articulaciones sobre el robot.
Funciona con la cámara y con **Probar demo 3D**. Los 64 huesos son controles del
modelo: el detector corporal sigue proporcionando 33 puntos medidos.

Las manos tienen palma compacta, dorso rojo, collar de muñeca y tres falanges
por dedo. Los dedos largos usan bisagras con un eje fijo, evitando que las placas
se inviertan al cerrar el puño. El pulgar tiene articulaciones propias para
oponerse sobre la palma. Las hombreras giran menos que el brazo, el casco tiene
una media luna curva y la armadura de brazos y muslos lleva bordes redondeados.

Los brazos separan cuatro movimientos: giro del hombro, flexión del codo,
pronación del antebrazo y flexión de muñeca. El codo funciona como una bisagra
con un máximo de 155 grados; la muñeca mecánica admite 92 grados de flexión y 60
de desviación lateral, con límites combinados y velocidad acotada. Girar la palma
rota el antebrazo, sin retorcer la muñeca.
La rueda del codo queda en el brazo y el collar de muñeca en el antebrazo.
Las hombreras acompañan la elevación del brazo sin copiar su torsión.
Las placas laterales de la cadera acompañan a cada muslo por separado. El plano
de la rodilla usa la dirección del pie observado para permitir girar la pierna
de lado sin anular su flexión. Mantiene una bisagra y límites de tobillo; la
respuesta de muslos, espinillas y pies aumenta con la velocidad medida.
El balanceo de pelvis admite hasta 46 grados y la inclinación se reparte entre
cadera y columna. La demo muestra rodillas altas, pasos y flexiones amplias.

El eje de rodilla se transporta desde reposo para conservar la flexión al dar
patadas por encima de la cadera. El tobillo se resuelve en el marco de la
espinilla y mantiene su orientación local si se ocultan los puntos del pie;
admite extender el empeine al arrodillarse. El apoyo del robot considera también
las rodilleras para evitar que se hundan en el suelo.
Cuando ambas muñecas medidas se acercan, el alcance se ajusta por posición con
dos segmentos de longitud fija. La oración requiere además dedos hacia arriba
en la pose o dos palmas detalladas recientes enfrentadas. Se orientan las palmas
y los codos para compensar las proporciones del torso. Sin detalles, la
orientación de oración es una aproximación de la pose, no nuevos puntos medidos.
Al separar las manos se vuelve gradualmente a las direcciones observadas.

La demo construye la orientación de cada mano a partir del antebrazo ya animado,
incluida la transición desde reposo. Los dedos acompañan al brazo al levantarlo;
la demo alterna palma abierta, puño y giro de mano, con flexión suave de muñeca.
src/arms.js contiene estos movimientos y las restricciones de las articulaciones.

## Abrir

### Demo de baile

Pulsa **Modo baile** o abre `https://lagan.nicolas16.life/?modo=baile`.
**Ver coreografía** permite ensayar sin encender la cámara y no suma puntos.
**Jugar con cámara** espera una postura estable, hace una cuenta atrás y empieza
una rutina original de 64 ritmos: unos 35 segundos a 112 BPM. La base musical
se genera con Web Audio en el equipo; no se descargan canciones.

El guía y tu samurái se dibujan con un único renderer y comparten la geometría.
El juego usa sólo Pose Lite y conserva la selección CPU/GPU por medición;
pausa manos y rostro para dedicar capacidad al cuerpo. Al volver al estudio
restaura el perfil elegido. La comparación usa los instantes de captura,
un margen de reacción y los ángulos de brazos, inclinación y rodillas.
Las sentadillas dan mayor peso a las rodillas. Los dedos y la posición exacta
de los pies no puntúan. Un cuerpo parcial reduce la cobertura y los puntos;
sin medidas válidas no hay puntos inventados. Si se pierde el cuerpo durante
un segundo se pausan reloj y música, conservando el progreso. El regreso exige
varias muestras estables y otra cuenta atrás. Una pestaña oculta pausa la ronda.

La primera demo es una prueba local de seguimiento, sin cuentas, clasificación
en línea ni grabación de cámara. No es un producto oficial de Just Dance.
`node tools/check-dance.mjs http://127.0.0.1:5181/` comprueba una ronda completa
con cámara simulada, ensayo sin puntos, pérdida y regreso, resultado, salida
al estudio y diseño móvil. Las pruebas unitarias incluyen medidas a 5 muestras/s.

### Estudio de movimiento

Haz doble clic en **iniciar_web.cmd**. Si la web ya está encendida, se abre esa
misma página. Dirección: **http://127.0.0.1:5173/**.

Pulsa **Encender cámara** y permite el acceso. Usa **Probar demo 3D** para ver
manos, piernas y gestos sin cámara. Chrome o Edge actualizado.

La cámara usa su imagen nativa, sin recorte del navegador. La guía de cabeza y
pies se ajusta al área real del video, también cuando hay bandas alrededor.
Si la cámara expone un control de zoom con el permiso existente, se reduce al
mínimo al iniciar; **Reducir zoom** permite repetirlo. No se solicitan permisos
adicionales de movimiento de cámara. Si todavía no caben cabeza y pies, hay que
alejar o reubicar la cámara: reducir el tamaño de la vista no recupera lo que
queda fuera del sensor.

## Publicar en el servidor

Para publicar en el servidor de Nicolás, ejecuta `bash tools/deploy_linux.sh`.
Compila los archivos de producción y reinicia el servicio de usuario
`samurai-web.service`, que escucha únicamente en `127.0.0.1:8090`.
En Cloudflare Tunnel, la ruta `lagan.nicolas16.life` usa
**Service URL: `http://localhost:8090`**, sin ruta adicional. La dirección pública
es `https://lagan.nicolas16.life`. El túnel entrega HTTPS al navegador; el origen
local usa HTTP. No es necesario abrir el puerto en el router.
Si la instalación indica que falta persistencia, ejecuta
`sudo loginctl enable-linger nicolas` en el servidor para iniciar también al
reiniciar y sin una sesión abierta.

Consulta el estado con `systemctl --user status samurai-web` y los mensajes con
`journalctl --user -u samurai-web -n 40`. Los archivos de producción están en
`tools/dist`; el servicio sólo publica esa carpeta.
Los modelos y el SDK se guardan en la caché del navegador durante un día;
`ASSET_VERSION` en `public/vision.worker.js` invalida esa caché al cambiarlos.
El cuerpo inicia primero y los detalles de manos y rostro se cargan después.
Cuando WebGL permite usar la GPU, cada detector compara CPU y GPU con los mismos
seis fotogramas, descartando los dos primeros de calentamiento. Conserva la opción
más rápida (si son similares, prefiere GPU para liberar CPU) y cierra el otro
modelo. Las comparaciones de cuerpo, manos y rostro se hacen por turnos. Si GPU
no inicia, falla o se bloquea, se usa CPU. El pie de los controles muestra el
procesador del cuerpo y **Copiar diagnóstico** incluye ambos tiempos y el
procesador elegido para manos y rostro. No se transfieren imágenes al servidor.
Si la primera comparación no encontró manos o rostro, se repite una sola vez
cuando aparecen, también por turnos. El diagnóstico registra los recursos
declarados por el navegador; la RAM es una aproximación. Con 2 GB o menos
de RAM declarada, Auto conserva sólo cuerpo para evitar cargar los otros modelos.

## Movimiento rápido

El modo **Baile y saltos · Auto** está seleccionado inicialmente. Empieza con
el modelo corporal ligero, que conserva los 33 puntos. Pueden trabajar el cuerpo
y un detalle a la vez; en una CPU de hasta dos núcleos disponibles se turnan. El cuerpo
tiene prioridad y los detalles se espacian según el tiempo de respuesta.
Después de seis búsquedas sin manos o rostro, esos detectores buscan con menos
frecuencia; al encontrarlos retoman su cadencia normal. El cuerpo sigue activo.
La carga de manos y rostro es escalonada para evitar iniciar tres modelos juntos.
Auto mide primero sólo el cuerpo: habilita detalles con suficiente capacidad,
los espacia cuatro veces cuando se acumula carga y los descarga ante respuesta
o dibujo muy lentos. Así conserva cuerpo, piernas, caderas y saltos. La pantalla
indica **Auto prioriza cuerpo** cuando pausa dedos y gestos. No oscila recargando
modelos: cambiar de perfil o encender la cámara de nuevo repite la medición.
**Rápido** solicita también manos y rostro de forma explícita. Cambiar entre
perfiles que usan Lite conserva el detector ya cargado y su selección CPU/GPU.
Los indicadores distinguen **FPS 3D**, **muestras corporales por segundo** y
tiempo de respuesta: el dibujo interpola entre las medidas, sin prometer una tasa fija.

El dibujo se limita a 60 FPS, ajusta su resolución ante carga sostenida y reduce
el trabajo al dejar la cámara apagada. Una pestaña oculta pausa el procesamiento.
La adaptación mide tiempo transcurrido: con 5 FPS no espera decenas de dibujos
para bajar la resolución y el límite de dibujo a 30 FPS.
Con carga extrema puede bajar hasta 37,5% de resolución 3D. Los modos que
priorizan cuerpo usan iluminación Lambert más sencilla; equipos con pocos
recursos empiezan sin antialias y con menor resolución. El samurái comparte
índices entre vértices idénticos: 54.143 vértices de dibujo en lugar de 77.364,
con las mismas superficies, colores, pesos y 64 huesos.
El encuadre del samurái usa envolventes de sus huesos, precalculadas al cargar,
en vez de volver a transformar todos los vértices de la armadura durante el baile.
Los puntos de cámara se dibujan por grupos, conservando cuerpo, dedos y rostro.

Si el equipo sigue lento, elige **Equipo lento · solo cuerpo**: conserva los
33 puntos corporales, piernas, caderas y saltos, descarga los detectores de manos
y rostro y empieza con dibujo a 30 FPS y menor resolución. Los dedos y gestos
faciales quedan en pausa; volver a Auto los reactiva. La persona fijada y la
calibración del suelo se conservan al cambiar entre estos modos.
**Copiar diagnóstico** comparte tasas, tiempos, CPU/GPU, resolución de cámara,
versión de la página y navegador. No copia imágenes, coordenadas ni identificadores
de cámara. El cálculo ocurre en el dispositivo de cada visitante.

El inicio confirma dos observaciones del mismo cuerpo, incluso si llegan con
650 ms de separación. Con hombros o caderas de confianza moderada necesita tres
observaciones consistentes. No reinicia la confirmación por tardar más de 400 ms.
La continuidad de confianza se adapta a la cadencia de muestras y dura como
máximo un segundo; sólo cuenta puntos realmente medidos, presentes y dentro de
la imagen. La referencia de ropa conserva su cromaticidad inicial al cambiar
la exposición. Los límites de posición, escala y torso mezclado siguen activos.
La caducidad de huesos y caderas cuenta la ausencia desde la recepción de las
medidas, evitando que el tiempo de cálculo descarte una postura recién recibida.
**Sensibilidad Alta** ajusta también los umbrales de MediaPipe, sin apagar la
cámara ni perder la persona fijada o los saltos; antes sólo cambiaba el filtro
del robot. Un cuerpo demasiado pequeño o desenfocado puede seguir sin detección.
`node tools/check-detection.mjs` prueba el detector real con una foto oficial y
variantes de escala, brillo y desenfoque; `npm test` comprueba continuidad y rechazo
de otras personas. Estas pruebas no sustituyen medir los equipos afectados.

Usa imágenes más pequeñas para
el detector corporal, evita procesar fotogramas repetidos y no acumula una cola.
La animación limita la velocidad de giro y desplazamiento, rechaza saltos aislados
y suaviza entre muestras. Los filtros responden más rápido al aumentar la velocidad
y comparan medidas consecutivas para no congelar un movimiento rápido continuo.
No extrapola movimientos al perder fotogramas. Las clavículas acompañan los brazos
elevados y las rodillas usan bisagras con límites de flexión y plano de giro estable.
El brazo responde más rápido a golpes coherentes hacia la cámara. Si el antebrazo
se acorta por escorzo, combina su proyección y el signo de profundidad observado
con una longitud previamente calibrada. Una reconstrucción breve no se cuenta
como un punto visible ni sustituye coordenadas 3D inválidas.
El bloqueo compara medidas compartidas al pasar de torso a cuerpo completo y
acompaña cambios graduales de distancia sin cambiar de persona.
Las rodillas flexionan hacia atrás sin invertir la armadura. Las espinilleras son
más estrechas, las rodilleras se unen al muslo y las botas separan talón y punta.
El apoyo se calcula con las suelas del modelo, con límites en tobillos y puntas.
La armadura y las manos se dibujan en una malla enlazada al esqueleto; la prueba
del modelo completo pasó de 87 a 10 llamadas de dibujo, incluidos rostro y escena.

- Baja **Suavizado** si quieres una respuesta más directa.
- **Equilibrado** y **Mayor precisión** requieren más procesamiento.
- Mantén buena luz: el desenfoque al moverte afecta a los puntos.
- Incluye cabeza y ambos pies, con margen. Los avisos indican qué articulaciones faltan.
- **Centrar postura** ajusta la referencia; **Recuperar seguimiento** reinicia el cuerpo.

## Caderas, baile y pérdidas de puntos

Al encender la cámara, colócate en el centro un momento. **Persona fijada**
confirma que el robot mantiene el mismo usuario. Se conserva su posición,
escala y una referencia temporal del color de la ropa. El detector sigue
limitado a un cuerpo. El detector corporal recibe siempre la imagen completa para
conservar un encuadre estable al bailar. Los recortes de detalle se concentran
alrededor de la persona fijada. Las manos y el rostro
se comprueban contra ese cuerpo antes de mover el robot. Si otra persona lo
tapa o el usuario sale, se espera su regreso. **Recuperar seguimiento** permite
elegir otra persona. Esta continuidad visual no es reconocimiento de identidad.
Tras una ausencia real de al menos un segundo, el regreso se confirma con tres
muestras consistentes (cinco si las anclas tienen confianza moderada), manteniendo
la referencia de ropa inicial. Permite volver en otra posición y distancia sin
apagar la cámara ni recargar modelos. Recalibra posición y suelo, conserva el
contador de saltos y descarta detalles de manos o rostro anteriores al regreso.
El cruce de otro cuerpo no activa esta búsqueda si no hubo una ausencia real.
`node tools/check-lower-body.mjs http://127.0.0.1:5181/` comprueba el modelo con
sentadillas, rodilla alta, giro lateral, caderas y pasos a ocho muestras/s. Estas
son pruebas de movimiento sintético, independientes de la precisión de la cámara.
`node tools/check-contacts.mjs http://127.0.0.1:5181/` comprueba patadas altas,
rodillas apoyadas, flexión profunda y palmas juntas con el torso girado, tanto
con la aproximación corporal como con orientación detallada de manos.

Para saltar, usa una cámara fija, muestra ambas caderas, hombros y pies, y deja los pies quietos
un momento para tomar el suelo como referencia. **Calibrar suelo** permite tomar
otra referencia sin perder el contador. Tobillos, talones y puntas aportan referencias
independientes: perder un tobillo no cancela los pies que todavía se ven.
El despegue responde antes de confirmar el contador. Dos medidas de elevación,
o una trayectoria ascendente previa y el vuelo, confirman el salto. Agacharse, ponerse
de puntillas con las puntas apoyadas, levantar una sola
pierna o subir los pies sentado no cuentan como salto. **Salto detectado**
muestra el evento y el contador. El robot se eleva y vuelve al suelo al
aterrizar; al perder los pies brevemente, conserva la altura y después la
reduce gradualmente. Deja espacio sobre la cabeza para no salir del encuadre.

Las dos caderas controlan el giro y el balanceo de la pelvis. El torso tiene su
propio giro: mover los hombros no gira automáticamente todo el robot. La
inclinación frontal de pelvis se aproxima a partir de la columna. La altura
sigue las flexiones de piernas y el desplazamiento de ambos pies.

El indicador **Caderas · 2/2 en seguimiento** confirma que hay una medida fiable.
Si una cadera se oculta brevemente, se conserva su orientación. Los puntos
inválidos mantienen la última articulación válida y la recuperación es gradual.
Las longitudes de brazos, piernas y dedos se conservan. Antebrazos y pies usan
orientaciones continuas al cruzar la dirección de la cámara; las muñecas se
suavizan respecto al antebrazo para acompañarlo durante cambios rápidos.

Los 33 puntos corporales son los que proporciona el detector; subir o bajar un
contador no mejora la medición. **Equilibrado** puede dar una postura más precisa,
con mayor tiempo de procesamiento. Mostrar ambas caderas, rodillas y tobillos
permite medirlos: las partes ocultas no se pueden reconstruir con certeza.

No hay un número de FPS garantizado: depende de la cámara y del equipo. Los tres
detectores corren en workers independientes y ajustan su frecuencia al tiempo
de procesamiento. Si una GPU deja de responder, se intenta recuperar usando CPU.

## Manos y expresiones

Las manos usan los 21 puntos de cada mano y sus coordenadas 3D: giro de palma,
separación de dedos y tres articulaciones del pulgar. La muñeca limita la flexión
para impedir que la mano atraviese el antebrazo. El lado se asocia a la muñeca
corporal y al movimiento anterior, incluso si se cruzan o el detector entrega
las manos en otro orden. Las proporciones son fijas: los puntos mueven las
articulaciones sin estirar dedos ni aplastar la palma. Se descartan estimaciones
degeneradas y saltos aislados de giro; al perder puntos, la mano conserva brevemente
su postura y vuelve de forma suave al reposo. La lógica está en src/hands.js.

El detector de manos también clasifica **puño cerrado**, **palma abierta**,
**índice extendido** y **pulgar arriba**. Una clasificación fiable ayuda a cerrar
las falanges ocultas por el propio puño. Un dedo inválido conserva su último
estado mientras los demás siguen moviéndose. El pulgar tiene tres direcciones
propias para oponerse sobre la palma, en lugar de doblarse como un dedo largo.

El lado anatómico de Tasks se conserva para la entrada de cámara sin espejo;
la imagen se refleja únicamente al mostrarla. Las manos del modelo tienen el
pulgar del lado correspondiente y distinguen palma y dorso. La posición detallada
de muñeca ajusta el antebrazo conservando
su profundidad. Si se pierde la mano, se alternan búsquedas cerca de las muñecas
con la imagen completa. **Manos** muestra el gesto reconocido o el estado de
búsqueda, en lugar de afirmar seguimiento por tener sólo puntos corporales.

El modelo local de manos es public/models/gesture.task; reemplaza al detector
anterior. Véanse el [reconocedor de gestos](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js)
y la [convención de lado de la mano](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/hand_landmark/hand_landmark_tracking_cpu.pbtxt).

**Mano** acerca una mano para revisar los dedos y conserva ese enfoque cuando
la detección se pierde brevemente. **Rostro** acerca la cabeza.
Puedes arrastrar para girar la vista y usar la rueda para acercar.
**Frente** y **Espalda** vuelven a mostrar el robot completo.

El rostro mueve boca, sonrisa o comisuras hacia abajo, labios fruncidos, párpados,
ojos abiertos y cejas de ambos lados. El control **Gestos** cambia su intensidad.
Mira de frente, relaja la boca y pulsa **Calibrar rostro**. Para obtener detalles,
acércate a la cámara; un rostro o una mano de pocos píxeles no permite medir bien
sus movimientos.

Cuerpo, manos y rostro se procesan por separado. Los puntos disponibles son 33
corporales, hasta 21 por mano y 478 faciales. No se añaden puntos medidos en partes
que están fuera de la imagen. Las imágenes de tu cámara se procesan en tu navegador.
Las manos se asocian con la muestra corporal más cercana en el tiempo, y sus
rotaciones se filtran en el mismo espacio que las del cuerpo, sin depender de
un giro de pelvis más reciente.

## Tres carpetas principales

| Carpeta | Contenido |
| --- | --- |
| **src/** | Interfaz, seguimiento, robot y estilos |
| **public/** | Geometría, icono, detector, modelos y motor de visión |
| **tools/** | Dependencias, configuración, instalación y pruebas |

La versión Python y las exportaciones antiguas se conservan como respaldo en
tools/referencia-python.zip. El código activo de la web utiliza estas tres carpetas.
La carpeta tools/pendiente-de-limpieza contiene los archivos antiguos mientras se
confirma su eliminación. La web no depende de ellos. La geometría base del cuerpo
está en public/robot.json. src/rig.js construye el esqueleto, la armadura y las
manos; src/avatar.js maneja la escena, las expresiones y la animación;
src/arms.js resuelve hombros, codos y muñecas; src/legs.js resuelve las bisagras
de rodilla; src/hands.js interpreta los puntos
de dedos y pulgares; src/person.js mantiene la persona seleccionada y filtra
los detalles; src/jump.js detecta despegue, aterrizaje y pérdidas de pies.

tools/node_modules son dependencias necesarias, tools/dist contiene la compilación
y tools/.cache guarda comprobaciones temporales. No hace falta editar esas carpetas.

## Instalar y comprobar

### Ejecutar en Linux por SSH

El proyecto debe estar en la carpeta del servidor, incluidos src, public y tools.
Con Node.js 22.12 o superior, instala las dependencias desde tools con `npm ci`.
Después inicia la web desde cualquier carpeta con:

~~~bash
bash /home/nicolas/Documents/robot/tools/iniciar_linux.sh
~~~

El lanzador también encuentra la instalación de Node del usuario en
`~/.local/share/robot-node/current/bin`. La web escucha en el puerto 5173 de
127.0.0.1 del servidor. Reenvía ese puerto por SSH y abre la dirección local
del túnel para usar la cámara de tu PC.

### Instalar y verificar en Windows

Requiere Node.js 22.12 o superior. La primera instalación descarga paquetes y modelos
oficiales. Después, cámara, modelos y motor se sirven localmente.

~~~powershell
cd tools
npm.cmd ci --ignore-scripts
npm.cmd run prepare
npm.cmd run dev -- --open
~~~

~~~powershell
cd tools
npm.cmd test
npm.cmd run build
~~~

Con el servidor abierto y Chrome instalado:

~~~powershell
cd tools
npm.cmd run test:browser
node check-motion.mjs
~~~

Las pruebas cubren recuperación, piernas, pulgares independientes, orientación de
palmas, asociación de manos, gestos por lado, giro independiente de pelvis/torso,
saltos, muestras inválidas y secuencias de baile con oclusiones. La prueba 3D
comprueba matrices, continuidad de orientación y conexión de muñecas y dedos
durante 360 fotogramas de movimiento simulado. Las pruebas del esqueleto también
comprueban pesos de vértices, longitudes constantes, cierre por bisagras y que
los vértices de los dedos se muevan al girar sus huesos.
Las fotos de puño, pulgar, índice y manos abiertas también pasan por el detector
real y el rig. Se comprueba el puño en ambas manos, el espejo, la oposición del
pulgar y la transformación de muñecas cuando se recorta la búsqueda.
Las pruebas de navegador usan fotos oficiales en una cámara simulada; no activan
tu cámara. Sus fotos y vídeos se eliminan al terminar. No necesitan Python.
Estas comprobaciones no sustituyen una prueba de baile real con tu cámara.
La prueba de brazos reproduce 20 segundos de la demo y comprueba la bisagra del
codo, la posición de muñecas, el giro del antebrazo, el seguimiento de la mano
y la continuidad de orientación. También guarda vistas de palma, puño y espalda.

Documentación oficial:
[Pose](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js),
[Hands](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js),
[Face](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
