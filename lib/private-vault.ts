import {ACCOUNT} from './store';

// This adapter is backed by the owner's captured vault and connector grants.
// A second account must use a separately commissioned tenant adapter.
export function isPersonalVaultAccount(account:unknown):account is string {
  return account===ACCOUNT;
}
export function requirePersonalVault(account:unknown):void {
  if(!isPersonalVaultAccount(account))throw new Error('This personal vault is not connected to that account.');
}
