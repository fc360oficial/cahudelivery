import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCatalogoController } from './admin-catalogo.controller';
import { AdminConfigController } from './admin-config.controller';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminAuthController, AdminController, AdminCatalogoController, AdminConfigController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
