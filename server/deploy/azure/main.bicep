// Plumb backend — Azure Container Apps.
//
// Deploys: Log Analytics + Container Apps environment + storage account with a
// file share for raw captures + the container app itself.
//
//   az deployment group create \
//     --resource-group rg-plumb \
//     --template-file main.bicep \
//     --parameters image=<registry>/plumb-backend:0.1.0 allowedOrigins='https://ethical-tech-colab.github.io'
//
// Container Apps is the right default here: scale-to-zero when no one is
// uploading, a real container, and no VM to patch.

@description('Deployment location.')
param location string = resourceGroup().location

@description('Base name; all resources derive from this.')
param name string = 'plumb'

@description('Container image, e.g. ghcr.io/ethical-tech-colab/plumb-backend:0.1.0')
param image string

@description('Comma-separated CORS allow-list. Do not leave as *.')
param allowedOrigins string = 'https://ethical-tech-colab.github.io'

@description('Public base URL of the deployed service, used in contract exports.')
param publicBaseUrl string = ''

@description('Require bearer-token auth for writes. Always true on a public host.')
param requireAuth bool = true

@description('API tokens, comma-separated. Generate with: openssl rand -hex 32')
@secure()
param apiTokens string = ''

@description('RFC 3161 timestamp authority URL. Empty disables trusted timestamps.')
param tsaUrl string = ''

@description('Minimum replicas. 0 enables scale-to-zero.')
param minReplicas int = 0

@description('Maximum replicas.')
param maxReplicas int = 3

var suffix = uniqueString(resourceGroup().id)
var storageName = toLower('${name}st${substring(suffix, 0, 8)}')
var shareName = 'plumb-data'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource fileServices 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

// Raw captures must outlive any container instance.
resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileServices
  name: shareName
  properties: {
    shareQuota: 1024
    enabledProtocols: 'SMB'
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: env
  name: 'plumb-data'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: shareName
      accessMode: 'ReadWrite'
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}-backend'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        // CORS is handled in-app so the allow-list semantics match
        // pages-ai-proxy exactly (exact | wildcard | *).
      }
      secrets: concat(
        empty(apiTokens) ? [] : [ { name: 'api-tokens', value: apiTokens } ]
      )
    }
    template: {
      containers: [
        {
          name: 'plumb-backend'
          image: image
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: concat(
            [
              { name: 'PLUMB_ENV', value: 'azure-container-apps' }
              { name: 'PLUMB_DATA_DIR', value: '/data' }
              { name: 'PLUMB_STORAGE', value: 'local' }
              { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
              { name: 'PLUMB_PUBLIC_BASE_URL', value: publicBaseUrl }
              { name: 'PLUMB_REQUIRE_AUTH', value: string(requireAuth) }
              { name: 'PLUMB_TSA_URL', value: tsaUrl }
            ],
            empty(apiTokens) ? [] : [ { name: 'PLUMB_API_TOKENS', secretRef: 'api-tokens' } ]
          )
          volumeMounts: [
            { volumeName: 'plumb-data', mountPath: '/data' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 8080 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/readyz', port: 8080 }
              initialDelaySeconds: 5
              periodSeconds: 15
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'plumb-data'
          storageType: 'AzureFile'
          storageName: envStorage.name
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: { metadata: { concurrentRequests: '20' } }
          }
        ]
      }
    }
  }
}

output backendUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output storageAccount string = storage.name
output note string = 'Set PLUMB_PUBLIC_BASE_URL to backendUrl and redeploy so contract exports carry correct image URLs.'
