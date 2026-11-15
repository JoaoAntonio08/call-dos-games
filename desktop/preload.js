// Avisa o site que ele está rodando dentro do app de Windows (útil para textos e ajustes futuros).
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("cdgDesktop", { app: "windows", version: process.versions.electron });
