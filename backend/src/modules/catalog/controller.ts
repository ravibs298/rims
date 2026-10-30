import type { Request, Response } from 'express';
import * as svc from './service';

export const list = async (req: Request, res: Response) => res.json(await svc.searchProducts(req.query));
export const get = async (req: Request, res: Response) => res.json(await svc.getProduct(Number(req.params.id)));
export const create = async (req: Request, res: Response) => res.status(201).json(await svc.createProduct(req.user!.id, req.body, req.ip ?? null));
export const update = async (req: Request, res: Response) => res.json(await svc.updateProduct(req.user!.id, Number(req.params.id), req.body, req.ip ?? null));
export const deactivate = async (req: Request, res: Response) => res.json(await svc.setActive(req.user!.id, Number(req.params.id), false, req.ip ?? null));
export const activate = async (req: Request, res: Response) => res.json(await svc.setActive(req.user!.id, Number(req.params.id), true, req.ip ?? null));
export const categories = async (_req: Request, res: Response) => res.json({ data: await svc.listCategories() });
export const createCategory = async (req: Request, res: Response) =>
  res.status(201).json(await svc.createCategory(req.user!.id, req.body.name, req.body.parent_id, req.ip ?? null));
