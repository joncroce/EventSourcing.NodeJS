import {
  Event,
  EventStore,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCanceled,
  ShoppingCartConfirmed,
  ShoppingCartEvent,
  ShoppingCartOpened,
  ShoppingCartStatus,
} from './businessLogic.solved.test';

export interface Repository<Entity, StreamEvent extends Event> {
  find(id: string): Entity;
  store(id: string, ...events: StreamEvent[]): void;
}

export class EventStoreRepository<Entity, StreamEvent extends Event>
  implements Repository<Entity, StreamEvent>
{
  constructor(
    private eventStore: EventStore,
    private getInitialState: () => Entity,
    private evolve: (state: Entity, event: StreamEvent) => Entity
  ) {}

  find = (id: string): Entity => {
    const events = this.eventStore.readStream<StreamEvent>(id);

    return events.reduce<Entity>(this.evolve, this.getInitialState());
  };

  store = (id: string, ...events: StreamEvent[]): void => {
    if (events.length === 0) return;

    this.eventStore.appendToStream(id, events);
  };
}

export abstract class ApplicationService<Entity, StreamEvent extends Event> {
  constructor(protected repository: Repository<Entity, StreamEvent>) {}

  protected on = (
    id: string,
    handle: (state: Entity) => StreamEvent | StreamEvent[]
  ) => {
    const aggregate = this.repository.find(id);

    const result = handle(aggregate);

    this.repository.store(id, ...(Array.isArray(result) ? result : [result]));
  };
}

export class ShoppingCart {
  private constructor(
    private _id: string,
    private _clientId: string,
    private _status: ShoppingCartStatus,
    private _openedAt: Date,
    private _productItems: PricedProductItem[] = [],
    private _confirmedAt?: Date,
    private _canceledAt?: Date
  ) {}

  get id() {
    return this._id;
  }

  get clientId() {
    return this._clientId;
  }

  get status() {
    return this._status;
  }

  get openedAt() {
    return this._openedAt;
  }

  get productItems() {
    return this._productItems;
  }

  get confirmedAt() {
    return this._confirmedAt;
  }

  get canceledAt() {
    return this._canceledAt;
  }

  public static default = () =>
    new ShoppingCart(
      undefined!,
      undefined!,
      undefined!,
      undefined!,
      undefined,
      undefined,
      undefined
    );

  public open = (
    shoppingCartId: string,
    clientId: string,
    now: Date
  ): ShoppingCartOpened => {
    return {
      type: 'ShoppingCartOpened',
      data: { shoppingCartId, clientId, openedAt: now },
    };
  };

  public addProductItem = (
    productItem: PricedProductItem
  ): ProductItemAddedToShoppingCart => {
    this.assertIsPending();

    return {
      type: 'ProductItemAddedToShoppingCart',
      data: { productItem, shoppingCartId: this._id },
    };
  };

  public removeProductItem = (
    productItem: PricedProductItem
  ): ProductItemRemovedFromShoppingCart => {
    this.assertIsPending();
    this.assertProductItemExists(productItem);

    return {
      type: 'ProductItemRemovedFromShoppingCart',
      data: { productItem, shoppingCartId: this._id },
    };
  };

  public confirm = (now: Date): ShoppingCartConfirmed => {
    this.assertIsPending();
    this.assertIsNotEmpty();

    return {
      type: 'ShoppingCartConfirmed',
      data: { shoppingCartId: this._id, confirmedAt: now },
    };
  };

  public cancel = (now: Date): ShoppingCartCanceled => {
    this.assertIsPending();

    return {
      type: 'ShoppingCartCanceled',
      data: { shoppingCartId: this._id, canceledAt: now },
    };
  };

  public static evolve = (
    state: ShoppingCart,
    { type, data: event }: ShoppingCartEvent
  ): ShoppingCart => {
    switch (type) {
      case 'ShoppingCartOpened': {
        state._id = event.shoppingCartId;
        state._clientId = event.clientId;
        state._status = ShoppingCartStatus.Pending;
        state._openedAt = event.openedAt;
        state._productItems = [];
        return state;
      }
      case 'ProductItemAddedToShoppingCart': {
        const {
          productItem: { productId, quantity, unitPrice },
        } = event;

        const currentProductItem = state._productItems.find(
          (pi) => pi.productId === productId && pi.unitPrice === unitPrice
        );

        if (currentProductItem) {
          currentProductItem.quantity += quantity;
        } else {
          state._productItems.push({ ...event.productItem });
        }
        return state;
      }
      case 'ProductItemRemovedFromShoppingCart': {
        const {
          productItem: { productId, quantity, unitPrice },
        } = event;

        const currentProductItem = state._productItems.find(
          (pi) => pi.productId === productId && pi.unitPrice === unitPrice
        );

        if (!currentProductItem) {
          return state;
        }

        currentProductItem.quantity -= quantity;

        if (currentProductItem.quantity <= 0) {
          state._productItems.splice(
            state._productItems.indexOf(currentProductItem),
            1
          );
        }
        return state;
      }
      case 'ShoppingCartConfirmed': {
        state._status = ShoppingCartStatus.Confirmed;
        state._confirmedAt = event.confirmedAt;
        return state;
      }
      case 'ShoppingCartCanceled': {
        state._status = ShoppingCartStatus.Canceled;
        state._canceledAt = event.canceledAt;
        return state;
      }
      default: {
        const _: never = type;
        throw new Error(ShoppingCartErrors.UNKNOWN_EVENT_TYPE);
      }
    }
  };

  private assertIsPending = (): void => {
    if (this._status !== ShoppingCartStatus.Pending) {
      throw new Error(ShoppingCartErrors.CART_IS_ALREADY_CLOSED);
    }
  };

  private assertProductItemExists = ({
    productId,
    quantity,
    unitPrice,
  }: PricedProductItem): void => {
    const currentQuantity =
      this.productItems.find(
        (p) => p.productId === productId && p.unitPrice == unitPrice
      )?.quantity ?? 0;

    if (currentQuantity < quantity) {
      throw new Error(ShoppingCartErrors.PRODUCT_ITEM_NOT_FOUND);
    }
  };

  private assertIsNotEmpty = (): void => {
    if (this._productItems.length === 0) {
      throw new Error(ShoppingCartErrors.CART_IS_EMPTY);
    }
  };
}

export const enum ShoppingCartErrors {
  CART_IS_ALREADY_CLOSED = 'CART_IS_ALREADY_CLOSED',
  PRODUCT_ITEM_NOT_FOUND = 'PRODUCT_ITEM_NOT_FOUND',
  CART_IS_EMPTY = 'CART_IS_EMPTY',
  UNKNOWN_EVENT_TYPE = 'UNKNOWN_EVENT_TYPE',
  UNKNOWN_COMMAND_TYPE = 'UNKNOWN_COMMAND_TYPE',
}

export type OpenShoppingCart = {
  shoppingCartId: string;
  clientId: string;
  now: Date;
};

export type AddProductItemToShoppingCart = {
  shoppingCartId: string;
  productItem: PricedProductItem;
};

export type RemoveProductItemFromShoppingCart = {
  shoppingCartId: string;
  productItem: PricedProductItem;
};

export type ConfirmShoppingCart = {
  shoppingCartId: string;
  now: Date;
};

export type CancelShoppingCart = {
  shoppingCartId: string;
  now: Date;
};

export type ShoppingCartCommand =
  | OpenShoppingCart
  | AddProductItemToShoppingCart
  | RemoveProductItemFromShoppingCart
  | ConfirmShoppingCart
  | CancelShoppingCart;

export class ShoppingCartService extends ApplicationService<
  ShoppingCart,
  ShoppingCartEvent
> {
  constructor(
    protected repository: Repository<ShoppingCart, ShoppingCartEvent>
  ) {
    super(repository);
  }

  public open = ({ shoppingCartId, clientId, now }: OpenShoppingCart) =>
    this.on(shoppingCartId, (shoppingCart) =>
      shoppingCart.open(shoppingCartId, clientId, now)
    );

  public addProductItem = ({
    shoppingCartId,
    productItem,
  }: AddProductItemToShoppingCart) =>
    this.on(shoppingCartId, (shoppingCart) =>
      shoppingCart.addProductItem(productItem)
    );

  public removeProductItem = ({
    shoppingCartId,
    productItem,
  }: RemoveProductItemFromShoppingCart) =>
    this.on(shoppingCartId, (shoppingCart) =>
      shoppingCart.removeProductItem(productItem)
    );

  public confirm = ({ shoppingCartId, now }: ConfirmShoppingCart) =>
    this.on(shoppingCartId, (shoppingCart) => shoppingCart.confirm(now));

  public cancel = ({ shoppingCartId, now }: CancelShoppingCart) =>
    this.on(shoppingCartId, (shoppingCart) => shoppingCart.cancel(now));
}
