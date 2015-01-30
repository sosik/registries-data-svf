(function() {
	'use strict';

	var log = require(process.cwd() + '/build/server/logging.js').getLogger('manglers/TransferHandler.js');
	var objectTools = require(process.cwd() + '/build/server/ObjectTools.js');
	var universalDaoModule = require(process.cwd() + '/build/server/UniversalDao.js');
	var dateUtils = require(process.cwd()+'/build/server/DateUtils.js').DateUtils;
	var QueryFilter = require(process.cwd()+'/build/server/QueryFilter.js');

	function TransferHandler(ctx) {
		this.ctx=ctx;
		var self=this;

		this.handleTransferChange=function(event){

			var entity = event.entity;

			var eventScheduler = this.ctx.eventScheduler;

			eventScheduler.unscheduleEvents(entity.id,null,function(err,data){
				if (err){log.error('unschedule',err);}

				if (entity.baseData.stateOfTransfer === 'schválený') {

					if (entity.baseData.typeOfTransfer === 'hosťovanie' ){

						var tsFrom = dateUtils.strToTS(entity.baseData.dateFrom);
						var tsTo = dateUtils.strToTS(entity.baseData.dateTo);

						if (tsFrom<tsTo){
							eventScheduler.scheduleEvent(tsFrom,'event-hosting-start',{transferId:entity.id},[entity.id],function(err,data){
								if (err){
									log.err(err);
									return;
								}
								eventScheduler.scheduleEvent(tsTo,'event-hosting-end',{transferId:entity.id},[entity.id],function(err,data){
									if (err){
										log.err(err);
										return;
									}
									log.debug('new events for transfer scheduled');
								} );
							} );

						}else {
							self.ctx.eventRegistry.emitProcesingError('Neplatny casovy rozsah. Transfer nebol vykonany.',event);
						}

					}
					else if (entity.baseData.typeOfTransfer === 'prestup' || entity.baseData.typeOfTransfer === 'zahr. transfér') {

						var tsRealization = dateUtils.strToTS(entity.baseData.dateOfRealization);
						if (tsRealization){
							eventScheduler.scheduleEvent(tsRealization,'event-transfer-realization',{transferId:entity.id},[entity.id],function(err,data){
								if (err){
									log.err(err);
									return;
								}
								log.debug('new events for transfer scheduled');
							} );
						} else {
							self.ctx.eventRegistry.emitProcesingError('Neplatny datum realizacie . Transfer nebol vykonany.',event);
						}
					}
				}
			});

		};

		this.removePlayerFromRoster=function(playerId,seasonId){

			var rostersDao = new universalDaoModule.UniversalDao(
				this.ctx.mongoDriver,
				{collectionName: 'rosters'}
			);

			var qf=QueryFilter.create();
			qf.addCriterium("baseData.season.oid",QueryFilter.operation.EQUAL,seasonId);
			qf.addCriterium("listOfPlayers.players",QueryFilter.operation.ALL,[{"registry" : "people","oid" : playerId}]);

			rostersDao.find(qf,function(err,rosters){

				if (err) {
					log.error(err);
				}
				rosters.forEach(function(roster){
					var filteredPlayers=[];
					 	roster.listOfPlayers.players.forEach(function(playerLink){
						if (playerLink && playerLink.oid!==playerId){
							filteredPlayers.push(playerLink);
						}
					});
					roster.listOfPlayers.players=filteredPlayers;
					roster.baseData.lastModification=new Date().getTime();
					rostersDao.save(roster,function(err){
						if (err){
							log.error(err);
							return;
						}
						log.debug("player removed from roster",playerId,roster);
					});
				});
			});
		}
		this.handleHostingStart=function (event){
			var self=this;
			var transferDao = new universalDaoModule.UniversalDao(
				this.ctx.mongoDriver,
				{collectionName: 'transfers'}
			);

			var peopleDao = new universalDaoModule.UniversalDao(
				this.ctx.mongoDriver,
				{collectionName: 'people'}
			);

			transferDao.get(event.transferId,function (err,transfer){
				if (err){log.error(err);return;}
				transfer.baseData.active='TRUE';
				self.peopleDao.get(transfer.baseData.player.oid,function(err,player){
					if (err){log.error(err);return;}
					if (!player.player){
						self.ctx.eventRegistry.emitProcesingError('Osoba nie je hracom. Transfer nebol vykonany.',event);
						return;
					}
					if (!player.player.club || !player.player.club.oid ){
						self.ctx.eventRegistry.emitProcesingError('Hrac nema definovany matersky klub. Transfer nebol vykonany.',event);
						return;
					}
					if ( player.player.club.oid!=transfer.baseData.clubFrom.oid){
						self.ctx.eventRegistry.emitProcesingError('Klub FROM sa nezhoduje s aktualnym klubom. Transfer nebol vykonany.',event);
						return;
					}
					player.player.club=transfer.baseData.clubTo;
					player.player.hostingStartDate=transfer.baseData.dateFrom;
					player.player.hostingEndDate=transfer.baseData.dateTo;
					var playerId=player.id;

					peopleDao.save(player, function(err,data){
						if (err){log.error(err);return;}

						transferDao.save(transfer,function(err,data){
							if (err){log.error(err);return;}
							log.verbose('transfer updated');
							self.removePlayerFromRoster(playerId,transfer.baseData.season.oid);
						});
					});
				});
			});

		};
		this.handleHostingEnd=function (event){
			var  self=this;
			var transferDao = new universalDaoModule.UniversalDao(
				this.ctx.mongoDriver,
				{collectionName: 'transfers'}
			);

			var peopleDao = new universalDaoModule.UniversalDao(
				this.ctx.mongoDriver,
				{collectionName: 'people'}
			);

			transferDao.get(event.transferId,function (err,transfer){
				if (err){log.error(err);return;}
					console.log(transfer);

				transfer.baseData.active='FALSE';

				peopleDao.get(transfer.baseData.player.oid,function(err,player){
					if (err){log.error(err);return;}

					if (!player.player){
							self.ctx.eventRegistry.emitProcesingError('Osoba nie je hracom. Transfer nebol vykonany.',event);
							return;
					}
					if (!player.player.club || !player.player.club.oid ){
							self.ctx.eventRegistry.emitProcesingError('Hrac nema definovany matersky klub. Transfer nebol vykonany.',event);
							return;
					}

					if (player.player.club.oid!=transfer.baseData.clubTo.oid){
						self.ctx.eventRegistry.emitProcesingError('Klub TO sa nezhoduje s aktualnym klubom. Transfer nebol vykonany.',event);
						return;
					}

					player.player.club=transfer.baseData.clubFrom;
					player.player.hostingStartDate=null;
					player.player.hostingEndDate=null;
					var playerId=player.id;
					peopleDao.save(player, function(err,data){
						if (err){log.error(err);return;}

						transferDao.save(transfer,function(err,data){
							if (err){log.error(err);return;}
							log.verbose('transfer updated');
							self.removePlayerFromRoster(playerId,transfer.baseData.season.oid);
						});

					});
				});
			});

		};
		this.handleTransferRealization=function (event){

			var transferDao = new universalDaoModule.UniversalDao(
				this.ctx.mongoDriver,
				{collectionName: 'transfers'}
			);

			var peopleDao = new universalDaoModule.UniversalDao(
				this.ctx.mongoDriver,
				{collectionName: 'people'}
			);

			transferDao.get(event.transferId,function (err,transfer){
				if (err){log.error(err);return;}
					console.log(transfer);

				transfer.baseData.active='FALSE';

				peopleDao.get(transfer.baseData.player.oid,function(err,player){
					if (err){log.error(err);return;}

					if (!player.player){
						self.ctx.eventRegistry.emitProcesingError('Osoba nie je hracom. Transfer nebol vykonany.',event);
						return;
					}
					if (!player.player.club || !player.player.club.oid ){
						self.ctx.eventRegistry.emitProcesingError('Hrac nema definovany matersky klub. Transfer nebol vykonany.',event);
						return;
					}
					if (player.player.club.oid!=transfer.baseData.clubFrom.oid){
						self.ctx.eventRegistry.emitProcesingError('Klub FROM sa nezhoduje s aktualnym klubom. Transfer nebol vykonany.',event);
						return;
					}

					player.player.club=transfer.baseData.clubTo;
					player.player.clubOfFirstRegistration=transfer.baseData.clubTo;
					var playerId=player.id;
					peopleDao.save(player, function(err,data){
						if (err){log.error(err);return;}

						transferDao.save(transfer,function(err,data){
							if (err){log.error(err);return;}
							self.removePlayerFromRoster(playerId,transfer.baseData.season.oid);
						});
					});
				});
			});

		};

	}

	TransferHandler.prototype.handle = function(event) {
		log.info('handle called',event,TransferHandler.prototype.ctx);

		if ("event-transfer-created" === event.eventType){
			this.handleTransferChange(event);
		} else

		if ("event-transfer-updated" === event.eventType){
			this.handleTransferChange(event);
		}else
		if ("event-hosting-start" === event.eventType){
			this.handleHostingStart(event);
		}else
		if ("event-hosting-end" === event.eventType){
			this.handleHostingEnd(event);
		}else

		if ("event-transfer-realization" === event.eventType){
			this.handleTransferRealization(event);
		}

	};

	TransferHandler.prototype.getType=function(){
		return ['event-transfer-updated','event-transfer-created','event-hosting-start','event-hosting-end','event-transfer-realization'];
	};


	module.exports = function( ctx) {
		return new TransferHandler(ctx );
	};
}());
