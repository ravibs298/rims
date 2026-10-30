import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { wrap } from '../../utils';
import * as ctl from './controller';
import { categoryBody, idParam, productBody, productQuery, productUpdateBody } from './schemas';

export const catalogRouter = Router();

catalogRouter.get('/categories', requirePermission('products.read'), wrap(ctl.categories));
catalogRouter.post('/categories', requirePermission('products.write'), validate({ body: categoryBody }), wrap(ctl.createCategory));

catalogRouter.get('/products', requirePermission('products.read'), validate({ query: productQuery }), wrap(ctl.list));
catalogRouter.post('/products', requirePermission('products.write'), validate({ body: productBody }), wrap(ctl.create));
catalogRouter.get('/products/:id', requirePermission('products.read'), validate({ params: idParam }), wrap(ctl.get));
catalogRouter.put('/products/:id', requirePermission('products.write'), validate({ params: idParam, body: productUpdateBody }), wrap(ctl.update));
catalogRouter.post('/products/:id/deactivate', requirePermission('products.write'), validate({ params: idParam }), wrap(ctl.deactivate));
catalogRouter.post('/products/:id/activate', requirePermission('products.write'), validate({ params: idParam }), wrap(ctl.activate));
