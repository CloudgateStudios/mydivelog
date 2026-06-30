import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { HealthService } from "./health.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  @ApiOkResponse({ description: "API process health check." })
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get("db")
  @ApiOkResponse({ description: "Database connectivity health check." })
  async getDatabaseHealth() {
    return this.healthService.getDatabaseHealth();
  }
}
