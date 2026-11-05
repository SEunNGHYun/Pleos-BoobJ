import { CanActivate, ExecutionContext, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { DATABASE, LocalDatabase } from '../database/local-database.js';
export interface ActorRequest {headers:Record<string,string|string[]|undefined>;actorId:string;}
@Injectable()
export class LocalAuthGuard implements CanActivate {
 constructor(@Inject(DATABASE) private readonly db:LocalDatabase|null){}
 async canActivate(context:ExecutionContext){
  if(!this.db)throw new ServiceUnavailableException('로컬 DB 연결을 먼저 설정해주세요.');
  const request=context.switchToHttp().getRequest<ActorRequest>();
  const header=request.headers.authorization;
  if(typeof header!=='string'||!header.startsWith('Bearer '))throw new UnauthorizedException();
  const id=await this.db.authenticate(header.slice(7));
  if(!id)throw new UnauthorizedException();
  request.actorId=id;return true;
 }
}
