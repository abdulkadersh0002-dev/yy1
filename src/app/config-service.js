import { appConfig } from './config.js';

export function getServerConfig() {
  return appConfig.server;
}

export function getTradingConfig() {
  return appConfig.trading;
}

export function getBrokerConfig() {
  return {
    brokers: appConfig.brokers,
    brokerRouting: appConfig.brokerRouting
  };
}

export function getServiceToggles() {
  return appConfig.services;
}

export function getAutoTradingConfig() {
  return appConfig.autoTrading;
}

export function getDatabaseConfig() {
  return appConfig.database;
}

export function getRawEnv() {
  return appConfig.env;
}

export function getPairPrefetchSettings() {
  return appConfig.pairPrefetch;
}

export function getFullAppConfig() {
  return appConfig;
}
