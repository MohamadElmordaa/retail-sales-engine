import { Module } from '@nestjs/common';
import { FxService } from './fx.service';

// Exports FxService only — the single seam for exchange rates. No other module
// reaches past it to a rate literal.
@Module({
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
