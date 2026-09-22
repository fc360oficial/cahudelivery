import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCatalogoController } from './admin-catalogo.controller';
import { AdminConfigController } from './admin-config.controller';
import { AdminPatrocinadoresController } from './admin-patrocinadores.controller';
import { AdminUploadController } from './admin-upload.controller';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { GeoModule } from '../geo/geo.module';
import { MunicipiosModule } from '../municipios/municipios.module';
import { MapaService } from './mapa.service';

@Module({
  imports: [GeoModule, MunicipiosModule],
  controllers: [
    AdminAuthController,
    AdminController,
    AdminCatalogoController,
    AdminConfigController,
    AdminPatrocinadoresController,
    AdminUploadController,
  ],
  providers: [AdminService, AdminGuard, MapaService],
})
export class AdminModule {}
