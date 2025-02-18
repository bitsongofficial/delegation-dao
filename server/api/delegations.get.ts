import newDelegations from '~~/data/output.json'

const addresses = [
  'bitsong166d42nyufxrh3jps5wx3egdkmvvg7jl6k33yut', // team
  'bitsong1n4akqrmpd29stwvh6dklzecplfha2asdtce9nn', // reserve
  'bitsong1nphhydjshzjevd03afzlce0xnlrnsm27hy9hgd', // btsg-delegations
  'bitsong1tgzday8yewn8n5j0prgsc9t5r3gg2cwnyf9jlv' // delegation dao
]

const endpoint = 'https://lcd.explorebitsong.com'

type Delegations = {
  delegation_responses: {
    delegation: {
      delegator_address: string
      validator_address: string
      shares: string
    }
    balance: {
      denom: string
      amount: string
    }
  }[]
  pagination: {
    next_key: string
    total: string
  }
}

type DelegatorRewards = {
  rewards: {
    delegator_address: string
    validator_address: string
    reward: {
      denom: string
      amount: string
    }[]
  }[]
  total: {
    denom: string
    amount: string
  }[]
}

type Validator = {
  operator_address: string
  consensus_pubkey: {
    type_url: string
    value: string
  }
  jailed: boolean
  status: string
  tokens: string
  delegator_shares: string
  description: {
    moniker: string
    identity: string
    website: string
    security_contact: string
    details: string
  }
  unbonding_height: string
  unbonding_time: string
  commission: {
    commission_rates: {
      rate: string
      max_rate: string
      max_change_rate: string
    }
    update_time: string
  }
  min_self_delegation: string
}

type ValidatorResponse = {
  validators: Validator[]
  pagination: {
    next_key: string
    total: string
  }
}

type StakingResponse = {
  total_amount: number
  total_rewards: number // only if denom is ubtsg
  new_delegations: number
  delegations: {
    address: string
    name: string
    status: string
    total_amount: number
    new_delegations: number
    total_rewards: number // only if denom is ubtsg
    total_new_delegations?: number
    delegators: {
      address: string
      amount: number
      rewards: number // only if denom is ubtsg
    }[]
  }[]
}

async function fetchDelegations(delegatorAddress: string) {
  return await $fetch<Delegations>(`${endpoint}/cosmos/staking/v1beta1/delegations/${delegatorAddress}?pagination.limit=2000`)
}

async function fetchDelegatorRewards(delegatorAddress: string) {
  const rewards = await $fetch<DelegatorRewards>(`${endpoint}/cosmos/distribution/v1beta1/delegators/${delegatorAddress}/rewards`)
  return {
    rewards: rewards.rewards.map((reward) => {
      return {
        ...reward,
        delegator_address: delegatorAddress
      }
    })
  }
}

async function fetchValidators() {
  return await $fetch<ValidatorResponse>(`${endpoint}/cosmos/staking/v1beta1/validators?pagination.limit=2000`)
}

export default defineEventHandler(async (_event) => {
  const validators = await fetchValidators()
  const all_delegations = await Promise.all(addresses.map(fetchDelegations))
  const all_rewards = await Promise.all(addresses.map(fetchDelegatorRewards))

  const stakingResponse: StakingResponse = {
    total_amount: 0,
    total_rewards: 0,
    delegations: []
  }

  for (const validator of validators.validators) {
    let total_amount = 0
    let total_rewards = 0
    let total_new_delegations = 0

    const delegators = all_delegations.flatMap(delegations => delegations.delegation_responses)
      .filter(delegation => delegation.delegation.validator_address === validator.operator_address)
      .map((delegation) => {
        let total_reward = 0

        for (const { rewards } of all_rewards) {
          for (const reward of rewards) {
            if (reward.validator_address === delegation.delegation.validator_address
              && reward.delegator_address === delegation.delegation.delegator_address
              && reward.reward.find(r => r.denom === 'ubtsg') !== undefined
            ) {
              total_reward += Number(reward.reward.find(r => r.denom === 'ubtsg')?.amount || 0) / 1_000_000
            }
          }
        }

        total_amount += Number(delegation.balance.amount) / 1_000_000
        total_rewards += total_reward

        return {
          address: delegation.delegation.delegator_address,
          amount: Number(delegation.balance.amount) / 1_000_000,
          rewards: total_reward
        }
      })

    const newAmount = newDelegations.validators.find(delegation => delegation.address === validator.operator_address)?.amount || 0
    total_new_delegations += newAmount

    stakingResponse.delegations.push({
      address: validator.operator_address,
      name: validator.description.moniker,
      status: validator.status,
      total_amount,
      total_rewards,
      delegators,
      new_delegations: newAmount
    })
  }

  return {
    total_amount: stakingResponse.delegations.reduce((acc, staking) => acc + staking.total_amount, 0),
    total_rewards: stakingResponse.delegations.reduce((acc, staking) => acc + staking.total_rewards, 0),
    new_delegations: stakingResponse.delegations.reduce((acc, staking) => acc + staking.new_delegations, 0),
    delegations: stakingResponse.delegations.filter(staking => staking.total_amount > 0 || staking.new_delegations > 0)
      .sort((a, b) => b.total_amount - a.total_amount)
      .map((staking) => {
        const keepValidators = [
          'bitsongvaloper19ah9302mh80pvv5zeztdr6qcqk6z52frn6rjj5', // KalpaTech
          'bitsongvaloper1wf3q0a3uzechxvf27reuqts8nqm45sn2yq26g3', // Cosmostation
          'bitsongvaloper10fg3yklae97g8ueh5ut29mlwz8fdr6z8zrak6x', // Validatrium
          'bitsongvaloper1fkj2cn209yeexxyets98evrcmmds23hck0lyzq', // ITA Stakers
          'bitsongvaloper1wetqg989uyj3mpk07h8yt3qvu2cdlsv7fp3zda' // Cryptocrew
        ]
        let new_delegations = staking.new_delegations
        if (keepValidators.includes(staking.address)) {
          new_delegations = staking.total_amount
        }
        return {
          ...staking,
          new_delegations
        }
      })
  }
})
