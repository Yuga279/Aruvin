/**
 * ============================================================================
 * FILE: chat-http.controller.ts
 * LOCATION: backend/src/http/chat-http.controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Expose exact P1 session and turn resource routes with HTTP status codes.
 *
 * ROLE IN PROJECT:
 *    Keeps controllers thin: path/query validation and status codes live here,
 *    while acceptance, execution, and streaming belong to service/transport.
 *
 * KEY COMPONENTS:
 *    - Session/message/status GETs: Navigation and durable archive reads.
 *    - Submit/retry/cancel POSTs: 202/204 acceptance without inference.
 *    - Stream GET: Request-owned SSE via ChatStreamTransport.
 * ============================================================================
 */

import { Body,Controller,Get,Post,Patch,Delete,Param,Query,Req,Res,HttpCode,Inject,UseFilters } from '@nestjs/common';
import type { Request,Response } from 'express';
import { ChatHttpService } from './chat-http.service.js';
import { ChatStreamTransport } from './chat-stream.transport.js';
import { ChatHttpFilter } from './chat-http.filter.js';
import { noQuery,pathId } from './validation.js';
@Controller('sessions')
@UseFilters(ChatHttpFilter)
export class ChatHttpController {
  constructor(@Inject(ChatHttpService) private service:ChatHttpService,
    @Inject(ChatStreamTransport) private transport:ChatStreamTransport) {}
  @Get() list(@Query() q:unknown) { return this.service.sessions(q); }
  @Post() @HttpCode(202) create(@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.submit(null,body);
  }
  @Get(':sessionId') session(@Param('sessionId') s:string,@Query() q:unknown) {
    noQuery(q); return this.service.session(pathId(s));
  }
  @Get(':sessionId/messages') messages(@Param('sessionId') s:string,@Query() q:unknown) {
    return this.service.messages(pathId(s),q);
  }
  @Patch(':sessionId') update(@Param('sessionId') s:string,@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.updateSession(pathId(s),body);
  }
  @Delete(':sessionId') @HttpCode(204) delete(@Param('sessionId') s:string,@Query() q:unknown) {
    noQuery(q); return this.service.deleteSession(pathId(s));
  }
  @Post(':sessionId/turns') @HttpCode(202) submit(@Param('sessionId') s:string,@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.submit(pathId(s),body);
  }
  @Get(':sessionId/turns/:turnId') status(@Param('sessionId') s:string,@Param('turnId') t:string,@Query() q:unknown) {
    noQuery(q); return this.service.status(pathId(s),pathId(t));
  }
  @Post(':sessionId/turns/:turnId/retry') @HttpCode(202)
  retry(@Param('sessionId') s:string,@Param('turnId') t:string,@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.retry(pathId(s),pathId(t),body);
  }
  @Post(':sessionId/turns/:turnId/cancel') @HttpCode(204)
  cancel(@Param('sessionId') s:string,@Param('turnId') t:string,@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.cancel(pathId(s),pathId(t),body);
  }
  @Post(':sessionId/turns/:turnId/retry-save') @HttpCode(202)
  retrySave(@Param('sessionId') s:string,@Param('turnId') t:string,@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.retrySave(pathId(s),pathId(t),body);
  }
  @Get(':sessionId/turns/:turnId/stream')
  stream(@Param('sessionId') s:string,@Param('turnId') t:string,@Query() q:unknown,@Req() req:Request,@Res() res:Response) {
    noQuery(q); return this.transport.open(pathId(s),pathId(t),req,res);
  }
}
