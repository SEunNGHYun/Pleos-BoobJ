import { Module, type DynamicModule } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { PickupController } from './pickup/pickup.controller.js';
import { PickupService } from './pickup/pickup.service.js';
import { LocalAuthGuard } from './pickup/auth.guard.js';
import { DATABASE, LocalDatabase } from './database/local-database.js';
@Module({})
export class AppModule {
 static register(db:LocalDatabase|null):DynamicModule {
  return {module:AppModule,controllers:[HealthController,PickupController],
   providers:[{provide:DATABASE,useValue:db},PickupService,LocalAuthGuard]};
 }
}
