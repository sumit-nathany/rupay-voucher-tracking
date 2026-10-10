import type { PortalCredentials } from './portal-credentials';

export type PortalFailureCode =
  | 'credentials_expired'
  | 'challenge_required'
  | 'offer_unavailable'
  | 'portal_changed'
  | 'network_pre_submit'
  | 'network_post_submit'
  | 'concurrent_change'
  | 'reservation_lease_expired'
  | 'worker_lost_after_submit_started'
  | 'tracker_reference_conflict'
  | 'unknown';

export class PortalOrderError extends Error {
  constructor(
    public readonly code: PortalFailureCode,
    message: string,
    public readonly isPostSubmit: boolean = false,
  ) {
    super(message);
    this.name = 'PortalOrderError';
  }
}

export interface PortalCardMappingInfo {
  portalCardId: string;
  portalCardbinId: string | null;
}

export interface ResolvedPortalCard {
  portalCardId: string;
  cardName: string;
}

export interface OrderRequest {
  portalCardId: string;
  portalCardbinId: string | null;
  serviceId?: string | null;
  offerId?: string | null;
}

export interface VerifiedOffer {
  available: boolean;
  offerName: string;
}

export interface ConfirmedOrder {
  bookingReference: string;
  confirmedAt: string; // ISO string
}

export interface PortalOrderClient {
  login(credentials: PortalCredentials): Promise<void>;
  resolveMappedCard(mapping: PortalCardMappingInfo): Promise<ResolvedPortalCard>;
  verifyOffer(request: OrderRequest): Promise<VerifiedOffer>;
  submitOrder(request: OrderRequest): Promise<ConfirmedOrder>;
  close(): Promise<void>;
}

export interface FakePortalClientOptions {
  loginError?: PortalOrderError;
  resolveCardError?: PortalOrderError;
  verifyOfferError?: PortalOrderError;
  offerUnavailable?: boolean;
  submitError?: PortalOrderError;
  bookingReference?: string;
}

/**
 * Deterministic mock portal client for tests, staging, and simulations.
 */
export class FakePortalOrderClient implements PortalOrderClient {
  public loggedIn = false;
  public closed = false;
  public calls: {
    login: PortalCredentials[];
    resolveCard: PortalCardMappingInfo[];
    verifyOffer: OrderRequest[];
    submitOrder: OrderRequest[];
  } = {
    login: [],
    resolveCard: [],
    verifyOffer: [],
    submitOrder: [],
  };

  constructor(private readonly opts: FakePortalClientOptions = {}) {}

  async login(credentials: PortalCredentials): Promise<void> {
    this.calls.login.push(credentials);
    if (this.opts.loginError) {
      throw this.opts.loginError;
    }
    this.loggedIn = true;
  }

  async resolveMappedCard(mapping: PortalCardMappingInfo): Promise<ResolvedPortalCard> {
    this.calls.resolveCard.push(mapping);
    if (this.opts.resolveCardError) {
      throw this.opts.resolveCardError;
    }
    return {
      portalCardId: mapping.portalCardId,
      cardName: `Card ${mapping.portalCardId}`,
    };
  }

  async verifyOffer(request: OrderRequest): Promise<VerifiedOffer> {
    this.calls.verifyOffer.push(request);
    if (this.opts.verifyOfferError) {
      throw this.opts.verifyOfferError;
    }
    if (this.opts.offerUnavailable) {
      return { available: false, offerName: 'Unavailable Offer' };
    }
    return { available: true, offerName: 'Test Verified Offer' };
  }

  async submitOrder(request: OrderRequest): Promise<ConfirmedOrder> {
    this.calls.submitOrder.push(request);
    if (this.opts.submitError) {
      throw this.opts.submitError;
    }
    return {
      bookingReference: this.opts.bookingReference ?? `BK-${Date.now().toString(36).toUpperCase()}`,
      confirmedAt: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
