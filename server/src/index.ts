import {
  createExpressApp,
  createSocketServer,
  createWebServer,
} from "./server";

const bootstrap = async () => {
  const expressApp = await createExpressApp();
  const webServer = await createWebServer(expressApp);
  const socketServer = await createSocketServer(webServer);
      
};

(async () => {
  await bootstrap();
})();
