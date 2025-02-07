//////////////////////////////////////
/// Shopping Carts
//////////////////////////////////////

import {
  JSONEventType,
  JSONRecordedEvent,
  RecordedEvent,
  ResolvedEvent,
  StreamingRead,
} from '@eventstore/db-client';
import { StreamAggregator } from '../core/streams';
import {
  addProductItem,
  assertProductItemExists,
  PricedProductItem,
  ProductItem,
  removeProductItem,
} from './productItem';
import { User } from './user';

//////////////////////////////////////
/// Events
//////////////////////////////////////

export type ShoppingCartOpened = JSONEventType<
  'shopping-cart-opened',
  {
    shoppingCartId: string;
    openedAt: string;
  }
>;

export type ProductItemAddedToShoppingCart = JSONEventType<
  'product-item-added-to-shopping-cart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    addedAt: string;
  }
>;

export type ProductItemRemovedFromShoppingCart = JSONEventType<
  'product-item-removed-from-shopping-cart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    removedAt: string;
  }
>;

export type ShoppingCartConfirmed = JSONEventType<
  'shopping-cart-confirmed',
  {
    shoppingCartId: string;
    user: User;

    additionalInfo: {
      content?: string;
      line1?: string;
      line2?: string;
    };
    confirmedAt: string;
  }
>;

export type ShoppingCartEvent =
  | ShoppingCartOpened
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed;

export const isCashierShoppingCartEvent = (
  event: RecordedEvent | null
): event is ShoppingCartEvent & JSONRecordedEvent => {
  return (
    event != null &&
    (event.type === 'shopping-cart-opened' ||
      event.type === 'product-item-added-to-shopping-cart' ||
      event.type === 'product-item-removed-from-shopping-cart' ||
      event.type === 'shopping-cart-confirmed')
  );
};

//////////////////////////////////////
/// Entity/State
//////////////////////////////////////

export const enum ShoppingCartStatus {
  Opened = 1,
  Confirmed = 2,
  Cancelled = 4,
  Closed = Confirmed | Cancelled,
}

export interface ShoppingCart {
  id: string;
  status: ShoppingCartStatus;
  productItems: PricedProductItem[];
}

export const enum ShoppingCartErrors {
  OPENED_EXISTING_CART = 'OPENED_EXISTING_CART',
  CART_IS_NOT_OPENED = 'CART_IS_NOT_OPENED',
  USER_DOES_NOT_EXISTS = 'USER_DOES_NOT_EXISTS',
  NO_PRODUCTS_ITEMS = 'NO_PRODUCTS_ITEMS',
  PRODUCT_ITEM_NOT_FOUND = 'PRODUCT_ITEM_NOT_FOUND',
  UNKNOWN_EVENT_TYPE = 'UNKNOWN_EVENT_TYPE',
}

export const toShoppingCartStreamName = (shoppingCartId: string) =>
  `shopping_cart-${shoppingCartId}`;

export const assertShoppingCartIsOpened = (shoppingCart: ShoppingCart) => {
  if (shoppingCart.status !== ShoppingCartStatus.Opened) {
    throw new Error(ShoppingCartErrors.CART_IS_NOT_OPENED);
  }
};

export const assertHasProductItems = (shoppingCart: ShoppingCart) => {
  if (shoppingCart.productItems.length === 0) {
    throw new Error(ShoppingCartErrors.NO_PRODUCTS_ITEMS);
  }
};

//////////////////////////////////////
/// Getting the state from events
//////////////////////////////////////

export const getShoppingCart = StreamAggregator<
  ShoppingCart,
  ShoppingCartEvent
>((currentState, event) => {
  switch (event.type) {
    case 'shopping-cart-opened':
      return {
        id: event.data.shoppingCartId,
        openedAt: new Date(event.data.openedAt),
        productItems: [],
        status: ShoppingCartStatus.Opened,
      };
    case 'product-item-added-to-shopping-cart':
      return {
        ...currentState,
        productItems: addProductItem(
          currentState.productItems,
          event.data.productItem
        ),
      };
    case 'product-item-removed-from-shopping-cart':
      return {
        ...currentState,
        productItems: removeProductItem(
          currentState.productItems,
          event.data.productItem
        ),
      };
    case 'shopping-cart-confirmed':
      return {
        ...currentState,
        status: ShoppingCartStatus.Confirmed,
      };
    default: {
      const _: never = event;
      console.error(`Unknown event type %s`, event);
      return currentState;
    }
  }
});

//////////////////////////////////////
/// Open shopping cart
//////////////////////////////////////

export type OpenShoppingCart = {
  shoppingCartId: string;
};

export const openShoppingCart = ({
  shoppingCartId,
}: OpenShoppingCart): ShoppingCartOpened => {
  return {
    type: 'shopping-cart-opened',
    data: {
      shoppingCartId,
      openedAt: new Date().toJSON(),
    },
  };
};

//////////////////////////////////////
/// Add product item to shopping cart
//////////////////////////////////////

export type AddProductItemToShoppingCart = {
  shoppingCartId: string;
  productItem: ProductItem;
};

export const addProductItemToShoppingCart = async (
  getPricedProduct: (productItem: ProductItem) => Promise<PricedProductItem>,
  events: StreamingRead<ResolvedEvent<ShoppingCartEvent>>,
  { shoppingCartId, productItem }: AddProductItemToShoppingCart
): Promise<ProductItemAddedToShoppingCart> => {
  const shoppingCart = await getShoppingCart(events);

  assertShoppingCartIsOpened(shoppingCart);

  const pricedProductItem = await getPricedProduct(productItem);

  return {
    type: 'product-item-added-to-shopping-cart',
    data: {
      shoppingCartId,
      productItem: pricedProductItem,
      addedAt: new Date().toJSON(),
    },
  };
};

//////////////////////////////////////
/// Remove product item to shopping cart
//////////////////////////////////////

export type RemoveProductItemFromShoppingCart = {
  shoppingCartId: string;
  productItem: ProductItem;
};

export const removeProductItemFromShoppingCart = async (
  events: StreamingRead<ResolvedEvent<ShoppingCartEvent>>,
  { shoppingCartId, productItem }: RemoveProductItemFromShoppingCart
): Promise<ProductItemRemovedFromShoppingCart> => {
  const shoppingCart = await getShoppingCart(events);

  assertShoppingCartIsOpened(shoppingCart);

  const current = assertProductItemExists(
    shoppingCart.productItems,
    productItem
  );

  return {
    type: 'product-item-removed-from-shopping-cart',
    data: {
      shoppingCartId,
      productItem: { ...current, quantity: productItem.quantity },
      removedAt: new Date().toJSON(),
    },
  };
};

//////////////////////////////////////
/// Confirm shopping cart
//////////////////////////////////////

export type ConfirmShoppingCart = {
  shoppingCartId: string;
  userId: number;
  additionalInfo: {
    content?: string;
    line1?: string;
    line2?: string;
  };
};

export const confirmShoppingCart = async (
  getUserData: (userId: number) => Promise<User | undefined>,
  events: StreamingRead<ResolvedEvent<ShoppingCartEvent>>,
  { shoppingCartId, additionalInfo, userId }: ConfirmShoppingCart
): Promise<ShoppingCartConfirmed> => {
  const shoppingCart = await getShoppingCart(events);

  assertShoppingCartIsOpened(shoppingCart);
  assertHasProductItems(shoppingCart);

  const user = await getUserData(userId);

  if (!user) {
    throw ShoppingCartErrors.USER_DOES_NOT_EXISTS;
  }

  return {
    type: 'shopping-cart-confirmed',
    data: {
      shoppingCartId,
      user,
      additionalInfo,
      confirmedAt: new Date().toJSON(),
    },
  };
};
