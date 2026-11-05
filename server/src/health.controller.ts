import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@babmatj/contracts';
import { DATABASE, LocalDatabase } from './database/local-database.js';

@Controller('health')
export class HealthController {
 constructor(@Inject(DATABASE)private readonly db:LocalDatabase|null){}
 @Get()
 health(): HealthResponse {
  return {
   status: 'ok',
   service: 'babmatj-server',
   database: this.db ? 'local_ready' : process.env.SUPABASE_URL ? 'not_verified' : 'not_configured',
  };
 }
}
