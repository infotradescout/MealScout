import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withScoutDishOwners, normalizeScoutBusinessKind } from '../../client/src/features/scout/scoutDiscoveryModel';
import { buildPublicProfilePath } from '../../client/src/lib/public-profile-path';
test('untyped trending dish uses its matching public food-truck owner', () => {
  const dish = { restaurantId:'truck-a', id:'dish-a', name:'Poke', restaurantName:'Island truck', priceCents:1800 };
  const [resolved] = withScoutDishOwners([dish], [{id:'truck-a',businessType:'food_truck',isFoodTruck:true}]);
  assert.equal(normalizeScoutBusinessKind(resolved,'restaurant'),'food_truck');
  assert.deepEqual(dish,{restaurantId:'truck-a',id:'dish-a',name:'Poke',restaurantName:'Island truck',priceCents:1800});
  assert.equal(buildPublicProfilePath({entityType:'restaurant',id:resolved.restaurantId,name:resolved.restaurantName,businessType:resolved.businessType}),'/truck/island-truck--truck-a');
});
test('same-name different business never supplies dish ownership', () => {
  const dish={restaurantId:'a',name:'Same name'};
  assert.equal(withScoutDishOwners([dish],[{id:'b',name:'Same name',isFoodTruck:true}])[0],dish);
});
test('dish pricing, eligibility and availability cannot be copied from owner evidence', () => {
  const [dish]=withScoutDishOwners([{restaurantId:'a',name:'Dish',isAvailable:false,priceCents:1200}], [{id:'a',businessType:'food_truck',isFoodTruck:true,isAvailable:true,priceCents:9999,isVerified:true}]);
  assert.equal(dish.isAvailable,false);assert.equal(dish.priceCents,1200);assert.equal('isVerified' in dish,false);
});
test('explicit dish identity fields are not overwritten by inference', () => {
  const [dish]=withScoutDishOwners([{restaurantId:'a',businessType:'bar',isFoodTruck:false}],[{id:'a',businessType:'restaurant',isFoodTruck:false}]);
  assert.equal(dish.businessType,'bar');assert.equal(dish.isFoodTruck,false);
});
test('missing owners and empty collections remain unchanged', () => {
  assert.deepEqual(withScoutDishOwners([],[]),[]);const dish={restaurantId:'a'};
  assert.equal(withScoutDishOwners([dish],[null,{},'invalid'])[0],dish);
});
