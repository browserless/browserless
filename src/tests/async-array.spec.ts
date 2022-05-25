import util from 'util';

import { expect } from 'chai';

import { AsyncArray } from '../async-array';

describe(`AsyncArray`, () => {
  it('resolves items to only one get', async () => {
    const swarm: AsyncArray<string> = new AsyncArray();

    const itemOne = swarm.get();
    const itemTwo = swarm.get();

    swarm.push('some-item');

    await new Promise((r) => setImmediate(r));

    expect(util.inspect(itemOne).includes('pending')).to.equal(false);
    expect(util.inspect(itemTwo).includes('pending')).to.equal(true);
  });
  it('pushes multiple items to multiple listeners', async () => {
    const swarm: AsyncArray<string> = new AsyncArray();

    const itemOne = swarm.get();
    const itemTwo = swarm.get();

    swarm.push('some-item');
    swarm.push('some-item');

    await new Promise((r) => setImmediate(r));

    expect(util.inspect(itemOne).includes('pending')).to.equal(false);
    expect(util.inspect(itemTwo).includes('pending')).to.equal(false);
  });
  it('resolves items that are already pushed', async () => {
    const swarm: AsyncArray<string> = new AsyncArray();
    swarm.push('some-item');

    const itemOne = swarm.get();
    const itemTwo = swarm.get();

    await new Promise((r) => setImmediate(r));

    expect(util.inspect(itemOne).includes('pending')).to.equal(false);
    expect(util.inspect(itemTwo).includes('pending')).to.equal(true);
  });
  it('resolves multiple items that are already pushed', async () => {
    const swarm: AsyncArray<string> = new AsyncArray();

    swarm.push('some-item');
    swarm.push('some-item');

    const itemOne = swarm.get();
    const itemTwo = swarm.get();

    await new Promise((r) => setImmediate(r));

    expect(util.inspect(itemOne).includes('pending')).to.equal(false);
    expect(util.inspect(itemTwo).includes('pending')).to.equal(false);
  });

  it(`doesn't resolve any items when none are available`, async () => {
    const swarm: AsyncArray<string> = new AsyncArray();

    const itemOne = swarm.get();
    const itemTwo = swarm.get();

    await new Promise((r) => setImmediate(r));

    expect(util.inspect(itemOne).includes('pending')).to.equal(true);
    expect(util.inspect(itemTwo).includes('pending')).to.equal(true);
  });

  it(`only resolves items that are available`, async () => {
    const swarm: AsyncArray<string> = new AsyncArray();

    swarm.push('some-item');
    swarm.push('some-item');

    const itemOne = swarm.get();
    const itemTwo = swarm.get();
    const itemThree = swarm.get();

    await new Promise((r) => setImmediate(r));

    expect(util.inspect(itemOne).includes('pending')).to.equal(false);
    expect(util.inspect(itemTwo).includes('pending')).to.equal(false);
    expect(util.inspect(itemThree).includes('pending')).to.equal(true);
  });

  it(`resolves items as they become available`, async () => {
    const swarm: AsyncArray<string> = new AsyncArray();

    const itemOne = swarm.get();
    const itemTwo = swarm.get();

    await new Promise((r) => setImmediate(r));

    expect(util.inspect(itemOne).includes('pending')).to.equal(true);
    expect(util.inspect(itemTwo).includes('pending')).to.equal(true);

    swarm.push('some-item');
    swarm.push('some-item');

    await new Promise((r) => setImmediate(r));

    expect(util.inspect(itemOne).includes('pending')).to.equal(false);
    expect(util.inspect(itemTwo).includes('pending')).to.equal(false);
  });
});
