import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestApplicationOptions } from '@nestjs/common';
import { AppModule } from './app.module.js';
import type { LocalDatabase } from './database/local-database.js';

export async function createApp(options: NestApplicationOptions = {}, database:LocalDatabase|null = null) {
 const app = await NestFactory.create(AppModule.register(database), options);
 app.setGlobalPrefix('api');
 app.enableShutdownHooks();
 return app;
}
